#include "PhoneConfig.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_gap_ble_api.h>
#include <esp_gatts_api.h>
#include "_Definitions.h"
#include "Settings/Settings.h"

static const char* TAG = "PHONE";

// shared between the BLE task (callbacks) and the main loop
static StreamBufferHandle_t rxBuffer = nullptr;
static volatile bool rxOverflow = false;
static volatile uint16_t peerMtu = 23;
static volatile uint32_t connectionCount = 0;
static volatile bool linkUp = false;                // a phone is connected
static volatile uint16_t connIntervalUnits = 0;     // 1.25 ms units, 0 = not known yet
static portMUX_TYPE peerMux = portMUX_INITIALIZER_UNLOCKED;
static esp_bd_addr_t peerBda = {0};
static PhoneConfig* active = nullptr;               // target of publishEvent

namespace {
    // game connection interval 100 ms, peripheral latency 0, supervision timeout 6 s (ADR 0005)
    const uint16_t GAME_INTERVAL_UNITS = 80;        // 1.25 ms units
    const uint16_t GAME_SUPERVISION_TIMEOUT = 600;  // 10 ms units

    // a line for the sender task; sent only if the phone of that connection is still there
    struct OutLine {
        std::string* text;
        uint32_t connection;
    };
    QueueHandle_t outQueue = nullptr;
    const UBaseType_t OUT_QUEUE_LENGTH = 8;

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
            connIntervalUnits = 0;
            connectionCount++;
            linkUp = true;
            BLEDevice::stopAdvertising();   // advertising is back after the disconnect
        }
        void onDisconnect(BLEServer* server) override {
            linkUp = false;
            // let the configuration software reconnect (also during a game)
            BLEDevice::startAdvertising();
        }
        void onMtuChanged(BLEServer* server, esp_ble_gatts_cb_param_t* param) override {
            peerMtu = param->mtu.mtu;
        }
    };

    // the peer address is needed for the connection parameter update
    void onGattsEvent(esp_gatts_cb_event_t event, esp_gatt_if_t gattsIf, esp_ble_gatts_cb_param_t* param) {
        if(event == ESP_GATTS_CONNECT_EVT) {
            portENTER_CRITICAL(&peerMux);
            memcpy(peerBda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
            portEXIT_CRITICAL(&peerMux);
        }
    }

    void onGapEvent(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t* param) {
        if(event == ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT && param->update_conn_params.status == ESP_BT_STATUS_SUCCESS) {
            connIntervalUnits = param->update_conn_params.conn_int;
        }
    }
}

PhoneConfig::PhoneConfig()
    : api("ble", UPLOAD_SLOT, [this](const std::string& text) { this->sendLine(text); }) {
    this->api.setMtuSource([]() { return (uint16_t)peerMtu; });
}

void PhoneConfig::start() {
    rxBuffer = xStreamBufferCreate(ConfigApi::MAX_REQUEST + 1024, 1);

    uint32_t setId = Settings::getOrCreateSetId();
    std::string name = PhoneConfig::advertisedName();
    BLEDevice::init(name);
    BLEDevice::setMTU(517);
    BLEDevice::setCustomGattsHandler(&onGattsEvent);
    BLEDevice::setCustomGapHandler(&onGapEvent);
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

    // priority 2: above the Arduino loop task (1, never yields), below the BLE stack tasks.
    // It waits for the confirmation of every indication, so the game loop never does.
    outQueue = xQueueCreate(OUT_QUEUE_LENGTH, sizeof(OutLine));
    xTaskCreate(&PhoneConfig::txTask, "bleTx", 4096, this, 2, nullptr);

    active = this;
    this->running = true;
}

void PhoneConfig::enterGame() {
    this->gameMode = true;
    this->gameIntervalPending = true;   // on the current connection, or on the next one
    this->api.abortUpload();            // a program upload cannot finish during the game
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

void PhoneConfig::describe(JsonObject out) const {
    bool connected = linkUp && this->running;
    out["connected"] = connected;
    out["intervalMs"] = connected ? (uint32_t)connIntervalUnits * 5 / 4 : 0;
}

void PhoneConfig::publishEvent(JsonDocument& event) {
    if(active == nullptr) {
        return;
    }
    std::string out;
    serializeJson(event, out);
    active->sendLine(out);
}

// Queues a line. Lines for a phone that is not connected are dropped here.
void PhoneConfig::sendLine(const std::string& text) {
    if(!this->running || outQueue == nullptr || !linkUp) {
        return;
    }
    OutLine item;
    item.text = new std::string(text);
    *item.text += '\n';
    item.connection = connectionCount;
    if(xQueueSend(outQueue, &item, 0) != pdTRUE) {
        delete item.text;
        ESP_LOGW(TAG, "response queue full, line dropped");
    }
}

void PhoneConfig::txTask(void* arg) {
    PhoneConfig* self = static_cast<PhoneConfig*>(arg);
    OutLine item;
    for(;;) {
        if(xQueueReceive(outQueue, &item, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        if(linkUp && item.connection == connectionCount) {
            self->indicateLine(*item.text);
        }
        delete item.text;
    }
}

// Indicates one line (with '\n') in MTU-sized pieces, waiting for each confirmation. Sender task only.
void PhoneConfig::indicateLine(const std::string& out) {
    size_t chunk = peerMtu > 3 ? peerMtu - 3 : 20;
    for(size_t pos = 0; pos < out.size(); pos += chunk) {
        size_t n = std::min(chunk, out.size() - pos);
        this->responseCharacteristic->setValue((uint8_t*)out.data() + pos, n);
        this->responseCharacteristic->indicate();   // waits for the confirmation (flow control)
    }
}

void PhoneConfig::requestGameInterval() {
    esp_ble_conn_update_params_t params = {};
    portENTER_CRITICAL(&peerMux);
    memcpy(params.bda, peerBda, sizeof(esp_bd_addr_t));
    portEXIT_CRITICAL(&peerMux);
    params.min_int = GAME_INTERVAL_UNITS;
    params.max_int = GAME_INTERVAL_UNITS;
    params.latency = 0;
    params.timeout = GAME_SUPERVISION_TIMEOUT;
    esp_err_t err = esp_ble_gap_update_conn_params(&params);
    this->gameIntervalPending = false;
    ESP_LOGI(TAG, "game connection interval requested: %s", esp_err_to_name(err));
}

void PhoneConfig::service() {
    if(!this->running || rxBuffer == nullptr) {
        return;
    }

    if(this->sessionConnection != connectionCount) {
        // a new client: it has to authenticate again (PIN)
        this->sessionConnection = connectionCount;
        this->api.newSession();
        this->gameIntervalPending = this->gameMode;     // a phone that connects during a game gets the game interval
        // drop what the previous client left behind (half a request in line, unread bytes in
        // rxBuffer). Done here in the main loop: the BLE task owns the producer side. Bytes the new
        // client writes between onConnect and this pass are dropped too; a client needs MTU
        // exchange / service discovery first, which takes far longer than one loop pass.
        this->line.clear();
        this->discarding = false;
        xStreamBufferReset(rxBuffer);
    }

    if(this->gameIntervalPending && linkUp) {
        this->requestGameInterval();
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
