#include "PhoneConfig.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "_Definitions.h"
#include "Settings/Settings.h"

// shared between the BLE task (callbacks) and the main loop
static StreamBufferHandle_t rxBuffer = nullptr;
static volatile bool rxOverflow = false;
static volatile uint16_t peerMtu = 23;
static volatile uint32_t connectionCount = 0;

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
            connectionCount++;
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

    uint32_t setId = Settings::getOrCreateSetId();
    std::string name = PhoneConfig::advertisedName();
    BLEDevice::init(name);
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

    this->configureAdvertising(setId, name);
    BLEDevice::startAdvertising();

    this->running = true;
}

std::string PhoneConfig::advertisedName() {
    String setName = Settings::getSetName();
    if(!setName.isEmpty()) {
        return std::string("ReactPod ") + setName.c_str();
    }
    char name[16];
    snprintf(name, sizeof(name), "ReactPod %04x", (unsigned)(Settings::getSetId() & 0xFFFF));
    return name;
}

void PhoneConfig::configureAdvertising(uint32_t setId, const std::string& name) {
    // advertisement (max 31 bytes): flags (3) + service UUID (18) + manufacturer data (8)
    BLEAdvertisementData adv;
    adv.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
    adv.setCompleteServices(BLEUUID(SERVICE_UUID));
    std::string manufacturer;
    manufacturer += (char)0xFF;     // company id 0xFFFF (no company, little endian)
    manufacturer += (char)0xFF;
    for(int shift = 24; shift >= 0; shift -= 8) {
        manufacturer += (char)((setId >> shift) & 0xFF);   // set id, big endian like "setId" in info
    }
    adv.setManufacturerData(manufacturer);

    // scan response: the complete name (max 2 + 25 bytes), the preferred connection interval if it fits
    BLEAdvertisementData scan;
    scan.setName(name);
    if(name.size() + 2 + 6 <= 31) {
        // 7.5 ms .. 22.5 ms, as setMinPreferred(0x06) / setMaxPreferred(0x12) before (helps iPhones)
        const char interval[] = {5, ESP_BLE_AD_TYPE_INT_RANGE, 0x06, 0x00, 0x12, 0x00};
        scan.addData(std::string(interval, sizeof(interval)));
    }

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->setAdvertisementData(adv);
    pAdvertising->setScanResponseData(scan);
    this->advertisedRevision = Settings::setNameRevision();
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

    if(this->sessionConnection != connectionCount) {
        // a new client: it has to authenticate again (PIN)
        this->sessionConnection = connectionCount;
        this->api.newSession();
    }

    if(this->advertisedRevision != Settings::setNameRevision()) {
        // setName: used for the next advertisement (after this connection ends)
        std::string name = PhoneConfig::advertisedName();
        esp_ble_gap_set_device_name(name.c_str());
        this->configureAdvertising(Settings::getSetId(), name);
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
