#include "PhoneConfig.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "_Definitions.h"

// shared between the BLE task (callbacks) and the main loop
static StreamBufferHandle_t rxBuffer = nullptr;
static volatile bool rxOverflow = false;
static volatile uint16_t peerMtu = 23;

namespace {
    class CommandCallbacks : public BLECharacteristicCallbacks {
        void onWrite(BLECharacteristic* characteristic) override {
            std::string value = characteristic->getValue();
            if(rxBuffer == nullptr || value.empty()) {
                return;
            }
            if(xStreamBufferSend(rxBuffer, value.data(), value.size(), 0) != value.size()) {
                rxOverflow = true;
            }
        }
    };

    class ServerCallbacks : public BLEServerCallbacks {
        void onConnect(BLEServer* server) override {
            peerMtu = 23;
        }
        void onDisconnect(BLEServer* server) override {
            // let the configuration software reconnect
            BLEDevice::startAdvertising();
        }
        void onMtuChanged(BLEServer* server, esp_ble_gatts_cb_param_t* param) override {
            peerMtu = param->mtu.mtu;
        }
    };
}

PhoneConfig::PhoneConfig()
    : api("ble", UPLOAD_SLOT, [this](const std::string& text) { this->sendLine(text); }) {}

void PhoneConfig::start() {
    rxBuffer = xStreamBufferCreate(ConfigApi::MAX_REQUEST + 1024, 1);

    BLEDevice::init("ReactPod Config");
    BLEDevice::setMTU(517);
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    this->maxLoopCharacteristic = pService->createCharacteristic(
        CHAR_MAX_LOOP_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );
    this->maxLoopCharacteristic->setValue("-1");

    this->commandCharacteristic = pService->createCharacteristic(
        CHAR_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    this->commandCharacteristic->setCallbacks(new CommandCallbacks());

    // indicate only: with NOTIFY offered too, Web Bluetooth / Android / bleak subscribe for
    // notifications, and the BLE library then drops every indication sent by sendLine
    this->responseCharacteristic = pService->createCharacteristic(
        CHAR_RESPONSE_UUID, BLECharacteristic::PROPERTY_INDICATE
    );
    this->responseCharacteristic->addDescriptor(new BLE2902());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMaxPreferred(0x12);
    BLEDevice::startAdvertising();

    this->running = true;
}

void PhoneConfig::stop() {
    if(!this->running) {
        return;
    }
    BLEDevice::stopAdvertising();
    // keep the controller memory: releasing it is not reversible and not needed
    BLEDevice::deinit(false);
    this->running = false;
    this->api.abortUpload();
}

bool PhoneConfig::getMaxLoops(int64_t& maxLoops) const {
    if(this->maxLoopCharacteristic == nullptr) {
        return false;
    }
    std::string value = this->maxLoopCharacteristic->getValue();
    char* end = nullptr;
    long long parsed = strtoll(value.c_str(), &end, 10);
    if(end == value.c_str() || *end != '\0' || parsed <= 0) {
        return false;
    }
    maxLoops = parsed;
    return true;
}

void PhoneConfig::sendLine(const std::string& text) {
    if(!this->running) {
        return;
    }
    std::string out = text;
    out += '\n';

    size_t chunk = peerMtu > 3 ? peerMtu - 3 : 20;
    for(size_t pos = 0; pos < out.size(); pos += chunk) {
        size_t n = std::min(chunk, out.size() - pos);
        this->responseCharacteristic->setValue((uint8_t*)out.data() + pos, n);
        this->responseCharacteristic->indicate();   // waits for the confirmation (flow control)
    }
}

void PhoneConfig::service() {
    if(!this->running || rxBuffer == nullptr) {
        return;
    }

    if(rxOverflow) {
        rxOverflow = false;
        this->line.clear();
        this->discarding = true;
        JsonDocument response;
        ConfigApi::setError(response, "overflow", "request data arrived faster than it could be processed");
        std::string out;
        serializeJson(response, out);
        this->sendLine(out);
    }

    char buffer[256];
    size_t n;
    while((n = xStreamBufferReceive(rxBuffer, buffer, sizeof(buffer), 0)) > 0) {
        for(size_t i = 0; i < n; i++) {
            char c = buffer[i];
            if(c == '\n') {
                if(!this->discarding && !this->line.empty()) {
                    this->api.handleRequest(this->line);
                    if(!this->running) {
                        return;     // the request selected a program: BLE is off now
                    }
                }
                this->line.clear();
                this->discarding = false;
                continue;
            }
            if(this->discarding) {
                continue;
            }
            if(this->line.size() >= ConfigApi::MAX_REQUEST) {
                this->line.clear();
                this->discarding = true;
                JsonDocument response;
                ConfigApi::setError(response, "too_large", "request too long");
                std::string out;
                serializeJson(response, out);
                this->sendLine(out);
                continue;
            }
            this->line += c;
        }
    }
}
