#include "PhoneConfig.h"
#include <NimBLEDevice.h>
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
static volatile uint16_t connHandle = BLE_HS_CONN_HANDLE_NONE;
static volatile bool subscribed = false;            // the phone enabled indications
static volatile bool indicateOk = false;            // result of the last indication
static SemaphoreHandle_t indicateDone = nullptr;    // given when an indication is confirmed (or the link is gone)
static NimBLEServer* server = nullptr;
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
    const uint32_t INDICATE_TIMEOUT_MS = 3000;      // one confirmation; NimBLE reports no result for a refused indication

    class CommandCallbacks : public NimBLECharacteristicCallbacks {
        void onWrite(NimBLECharacteristic* characteristic) override {
            NimBLEAttValue value = characteristic->getValue();
            if(rxBuffer == nullptr || value.length() == 0) {
                return;
            }
            if(xStreamBufferSend(rxBuffer, value.data(), value.length(), 0) != value.length()) {
                rxOverflow = true;
            }
        }
    };

    class ResponseCallbacks : public NimBLECharacteristicCallbacks {
        void onSubscribe(NimBLECharacteristic* characteristic, ble_gap_conn_desc* desc, uint16_t subValue) override {
            subscribed = subValue != 0;
        }
        void onStatus(NimBLECharacteristic* characteristic, Status s, int code) override {
            indicateOk = (s == SUCCESS_INDICATE);
            xSemaphoreGive(indicateDone);
        }
    };

    class ServerCallbacks : public NimBLEServerCallbacks {
        void onConnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) override {
            peerMtu = 23;
            connIntervalUnits = 0;
            connHandle = desc->conn_handle;
            subscribed = false;
            connectionCount++;
            linkUp = true;
            NimBLEDevice::stopAdvertising();   // advertising is back after the disconnect
        }
        void onDisconnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) override {
            linkUp = false;
            subscribed = false;
            connHandle = BLE_HS_CONN_HANDLE_NONE;
            indicateOk = false;
            xSemaphoreGive(indicateDone);       // wakes the sender task if it waits for a confirmation
            // let the configuration software reconnect (also during a game)
            NimBLEDevice::startAdvertising();
        }
        void onMTUChange(uint16_t mtu, ble_gap_conn_desc* desc) override {
            peerMtu = mtu;
        }
    };
}

PhoneConfig::PhoneConfig()
    : api("ble", UPLOAD_SLOT, [this](const std::string& text) { this->sendLine(text); }) {
    this->api.setMtuSource([]() { return (uint16_t)peerMtu; });
}

void PhoneConfig::start() {
    rxBuffer = xStreamBufferCreate(ConfigApi::MAX_REQUEST + 1024, 1);

    uint32_t setId = Settings::getOrCreateSetId();
    std::string name = PhoneConfig::advertisedName();
    indicateDone = xSemaphoreCreateBinary();
    NimBLEDevice::init(name);
    NimBLEDevice::setMTU(517);
    server = NimBLEDevice::createServer();
    server->setCallbacks(new ServerCallbacks());
    server->advertiseOnDisconnect(false);   // onDisconnect restarts it
    NimBLEService *pService = server->createService(SERVICE_UUID);

    this->maxLoopCharacteristic = pService->createCharacteristic(
        CHAR_MAX_LOOP_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::READ
    );
    this->maxLoopCharacteristic->setValue("-1");

    this->commandCharacteristic = pService->createCharacteristic(
        CHAR_COMMAND_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    this->commandCharacteristic->setCallbacks(new CommandCallbacks());

    // indicate only: with NOTIFY offered too, Web Bluetooth / Android / bleak subscribe for
    // notifications, and the BLE library then drops every indication sent by sendLine.
    // NimBLE creates the client characteristic configuration descriptor itself.
    this->responseCharacteristic = pService->createCharacteristic(
        CHAR_RESPONSE_UUID, NIMBLE_PROPERTY::INDICATE
    );
    this->responseCharacteristic->setCallbacks(new ResponseCallbacks());

    pService->start();

    this->configureAdvertising(setId, name);
    NimBLEDevice::startAdvertising();

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
    NimBLEAdvertisementData adv;
    adv.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
    adv.setCompleteServices(NimBLEUUID(SERVICE_UUID));
    std::string manufacturer;
    manufacturer += (char)0xFF;     // company id 0xFFFF (no company, little endian)
    manufacturer += (char)0xFF;
    for(int shift = 24; shift >= 0; shift -= 8) {
        manufacturer += (char)((setId >> shift) & 0xFF);   // set id, big endian like "setId" in info
    }
    adv.setManufacturerData(manufacturer);

    // scan response: the complete name (max 2 + 25 bytes), the preferred connection interval if it fits
    NimBLEAdvertisementData scan;
    scan.setName(name);
    if(name.size() + 2 + 6 <= 31) {
        // 7.5 ms .. 22.5 ms, as setMinPreferred(0x06) / setMaxPreferred(0x12) before (helps iPhones)
        const char interval[] = {5, BLE_HS_ADV_TYPE_SLAVE_ITVL_RANGE, 0x06, 0x00, 0x12, 0x00};
        scan.addData(std::string(interval, sizeof(interval)));
    }

    NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->setAdvertisementData(adv);
    pAdvertising->setScanResponseData(scan);
    this->advertisedRevision = Settings::setNameRevision();
}

bool PhoneConfig::getMaxLoops(int64_t& maxLoops) const {
    if(this->maxLoopCharacteristic == nullptr) {
        return false;
    }
    NimBLEAttValue stored = this->maxLoopCharacteristic->getValue();
    std::string value((const char*)stored.data(), stored.length());
    char* end = nullptr;
    long long parsed = strtoll(value.c_str(), &end, 10);
    if(end == value.c_str() || *end != '\0' || parsed <= 0) {
        return false;
    }
    maxLoops = parsed;
    return true;
}

bool PhoneConfig::connected() const {
    return linkUp && this->running;
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
// NimBLE's indicate() returns at once and drops a second indication while one is outstanding,
// so the confirmation (onStatus) is the flow control.
void PhoneConfig::indicateLine(const std::string& out) {
    size_t chunk = peerMtu > 3 ? peerMtu - 3 : 20;
    for(size_t pos = 0; pos < out.size(); pos += chunk) {
        if(!linkUp || !subscribed) {
            return;
        }
        size_t n = std::min(chunk, out.size() - pos);
        xSemaphoreTake(indicateDone, 0);            // a stale confirmation
        indicateOk = false;
        this->responseCharacteristic->indicate((const uint8_t*)out.data() + pos, n);
        if(xSemaphoreTake(indicateDone, pdMS_TO_TICKS(INDICATE_TIMEOUT_MS)) != pdTRUE) {
            ESP_LOGW(TAG, "indication not confirmed, line dropped");
            return;
        }
        if(!indicateOk) {
            return;
        }
    }
}

void PhoneConfig::requestGameInterval() {
    this->gameIntervalPending = false;
    if(server == nullptr || connHandle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    server->updateConnParams(connHandle, GAME_INTERVAL_UNITS, GAME_INTERVAL_UNITS, 0, GAME_SUPERVISION_TIMEOUT);
    ESP_LOGI(TAG, "game connection interval requested");
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

    // NimBLE reports no connection parameter update to the server: poll the interval
    static uint32_t lastIntervalPoll = 0;
    if(linkUp && server != nullptr && millis() - lastIntervalPoll >= 500) {
        lastIntervalPoll = millis();
        if(server->getConnectedCount() > 0) {
            connIntervalUnits = server->getPeerInfo(0).getConnInterval();
        }
    }

    if(this->advertisedRevision != Settings::setNameRevision()) {
        // setName: used for the next advertisement (after this connection ends)
        std::string name = PhoneConfig::advertisedName();
        NimBLEDevice::setDeviceName(name);
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
