// Hardware test #38 (BLE connected while ESP-NOW runs). Only built with REACTPOD_BLE_ESPNOW_TEST,
// see BleEspNowTest.h. The normal build compiles this file to nothing.
#include "BleEspNowTest.h"

#ifdef REACTPOD_BLE_ESPNOW_TEST

#include <BLEDevice.h>
#include <BLECharacteristic.h>
#include <esp_gap_ble_api.h>
#include <esp_gatts_api.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "Roles/Central/PhoneConfig.h"
#include "Link/EspNowLink.h"
#include "Config/Console.h"

static const char* TAG = "BLETEST";

// ---------------------------------------------------------------- shared with the BLE task

namespace {
    portMUX_TYPE peerMux = portMUX_INITIALIZER_UNLOCKED;
    esp_bd_addr_t peerBda = {0};

    volatile bool connected = false;
    volatile bool gameFlag = false;             // copy of inGame for the BLE task
    volatile uint32_t connects = 0;
    volatile uint32_t disconnects = 0;
    volatile uint32_t gameDisconnects = 0;      // disconnects after the program was selected
    volatile uint16_t lastDisconnectReason = 0; // esp_gatt_conn_reason_t (0x08 timeout, 0x13 remote, 0x16 local, ...)
    volatile uint32_t connectedAtMs = 0;

    volatile uint16_t connInterval = 0;         // 1.25 ms units, 0 = unknown
    volatile uint16_t connLatency = 0;
    volatile uint16_t connTimeout = 0;          // 10 ms units
    volatile uint32_t paramUpdates = 0;
    volatile uint32_t paramRejects = 0;

    volatile uint32_t indicateOk = 0;
    volatile uint32_t indicateTimeouts = 0;
    volatile uint32_t indicateFailed = 0;       // GATT error, no client, indications disabled

    // indication task
    struct TxItem {
        std::string* text;
        int64_t queuedUs;
    };
    QueueHandle_t txQueue = nullptr;
    const UBaseType_t TX_QUEUE_LENGTH = 16;
    volatile int64_t txBusySinceUs = 0;         // 0 = idle
    volatile uint32_t txLines = 0;
    volatile uint32_t txBytes = 0;
    volatile uint32_t txDropped = 0;            // queue full: the line was not sent
    volatile uint32_t txWaitUsMax = 0;          // queued -> task picked it up
    volatile uint32_t txSendUsMax = 0;          // all indications of one line (incl. confirmations)
    volatile uint32_t txSendUsAvg = 0;          // moving average (1/8)

    void onGattsEvent(esp_gatts_cb_event_t event, esp_gatt_if_t gattsIf, esp_ble_gatts_cb_param_t* param) {
        switch(event) {
            case ESP_GATTS_CONNECT_EVT:
                portENTER_CRITICAL(&peerMux);
                memcpy(peerBda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
                portEXIT_CRITICAL(&peerMux);
                connInterval = 0;
                connectedAtMs = millis();
                connected = true;
                connects++;
                break;
            case ESP_GATTS_DISCONNECT_EVT:
                connected = false;
                connInterval = 0;
                lastDisconnectReason = (uint16_t)param->disconnect.reason;
                disconnects++;
                if(gameFlag) {
                    gameDisconnects++;
                }
                break;
            default:
                break;
        }
    }

    void onGapEvent(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t* param) {
        if(event != ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT) {
            return;
        }
        if(param->update_conn_params.status == ESP_BT_STATUS_SUCCESS) {
            connInterval = param->update_conn_params.conn_int;
            connLatency = param->update_conn_params.latency;
            connTimeout = param->update_conn_params.timeout;
            paramUpdates++;
        } else {
            paramRejects++;
        }
    }

    class ResponseCallbacks : public BLECharacteristicCallbacks {
        void onStatus(BLECharacteristic* characteristic, Status s, uint32_t code) override {
            switch(s) {
                case Status::SUCCESS_INDICATE: indicateOk++; break;
                case Status::ERROR_INDICATE_TIMEOUT: indicateTimeouts++; break;
                case Status::SUCCESS_NOTIFY: break;
                default: indicateFailed++; break;
            }
        }
    };

    uint32_t usSince(int64_t sinceUs, int64_t nowUs) {
        int64_t d = nowUs - sinceUs;
        return d < 0 ? 0 : (d > (int64_t)UINT32_MAX ? UINT32_MAX : (uint32_t)d);
    }
}

// ---------------------------------------------------------------- central

BleEspNowTest& BleEspNowTest::get() {
    static BleEspNowTest test;
    return test;
}

void BleEspNowTest::begin(PhoneConfig* phone) {
    this->phone = phone;
    BLEDevice::setCustomGattsHandler(&onGattsEvent);
    BLEDevice::setCustomGapHandler(&onGapEvent);

    if(txQueue == nullptr) {
        txQueue = xQueueCreate(TX_QUEUE_LENGTH, sizeof(TxItem));
        // priority 2: above the Arduino loop task (1, never yields), below the BLE stack tasks.
        // The task only waits for confirmations, so it takes µs of CPU per indication.
        xTaskCreate(&BleEspNowTest::txTask, "bleTestTx", 4096, this, 2, nullptr);
    }
    Console.println("BLE+ESP-NOW TEST BUILD (#38): BLE stays on during the game");
}

void BleEspNowTest::attachResponse(BLECharacteristic* response) {
    if(response != nullptr) {
        response->setCallbacks(new ResponseCallbacks());
    }
}

bool BleEspNowTest::enterGame() {
    this->inGame = true;
    gameFlag = true;
    this->bleOn = this->keepBle;
    ESP_LOGI(TAG, "program selected, BLE %s", this->bleOn ? "stays on" : "off (keepBle false)");
    return this->bleOn;
}

bool BleEspNowTest::queueLine(const std::string& line) {
    if(txQueue == nullptr) {
        return false;
    }
    TxItem item;
    item.text = new std::string(line);
    item.queuedUs = esp_timer_get_time();
    if(xQueueSend(txQueue, &item, 0) != pdTRUE) {
        delete item.text;
        txDropped++;
    }
    return true;
}

void BleEspNowTest::txTask(void* arg) {
    BleEspNowTest* self = (BleEspNowTest*)arg;
    TxItem item;
    for(;;) {
        if(xQueueReceive(txQueue, &item, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        int64_t start = esp_timer_get_time();
        txBusySinceUs = start;
        uint32_t wait = usSince(item.queuedUs, start);
        if(wait > txWaitUsMax) {
            txWaitUsMax = wait;
        }

        if(self->phone != nullptr && self->bleOn) {
            self->phone->indicateLine(*item.text);   // waits for each confirmation (in this task only)
        }

        uint32_t send = usSince(start, esp_timer_get_time());
        txBusySinceUs = 0;
        if(send > txSendUsMax) {
            txSendUsMax = send;
        }
        txSendUsAvg = txLines == 0 ? send : txSendUsAvg - txSendUsAvg / 8 + send / 8;
        txLines++;
        txBytes += item.text->size();
        delete item.text;
    }
}

void BleEspNowTest::requestInterval() {
    esp_ble_conn_update_params_t params = {};
    portENTER_CRITICAL(&peerMux);
    memcpy(params.bda, peerBda, sizeof(esp_bd_addr_t));
    portEXIT_CRITICAL(&peerMux);

    uint16_t units = (uint16_t)((uint32_t)this->intervalMs * 4 / 5);   // 1.25 ms units
    if(units < 6) units = 6;                // 7.5 ms, BLE minimum
    if(units > 3200) units = 3200;          // 4 s, BLE maximum
    params.min_int = units;
    params.max_int = units;
    params.latency = 0;
    params.timeout = 600;                   // 6 s supervision timeout (10 ms units)

    esp_err_t err = esp_ble_gap_update_conn_params(&params);
    this->intervalRequests++;
    ESP_LOGI(TAG, "connection interval %u ms requested: %s", (unsigned)this->intervalMs, esp_err_to_name(err));
}

void BleEspNowTest::sendLoad(uint32_t nowMs) {
    // {"event":"load","seq":123,"t":4567,"pad":"xxxx"}\n with loadBytes bytes in total
    char head[64];
    int n = snprintf(head, sizeof(head), "{\"event\":\"load\",\"seq\":%lu,\"t\":%lu,\"pad\":\"",
                     (unsigned long)this->loadSeq, (unsigned long)nowMs);
    if(n <= 0) {
        return;
    }
    std::string line(head, (size_t)n);
    size_t tail = 3;    // "}\n
    if(this->loadBytes > line.size() + tail) {
        line.append(this->loadBytes - line.size() - tail, 'x');
    }
    line += "\"}\n";
    this->loadSeq++;
    this->loadSent++;
    this->queueLine(line);
}

void BleEspNowTest::service() {
    int64_t nowUs = esp_timer_get_time();
    if(this->lastServiceUs != 0) {
        uint32_t gap = usSince(this->lastServiceUs, nowUs);
        if(gap > this->loopGapUsMax) this->loopGapUsMax = gap;
        if(gap > 2000) this->loopGaps2ms++;
        if(gap > 10000) this->loopGaps10ms++;
    }
    this->lastServiceUs = nowUs;

    if(!this->bleOn || !connected) {
        return;
    }
    uint32_t nowMs = millis();
    if(this->inGame && this->intervalMs > 0 && this->intervalRequestedFor != connects
       && nowMs - connectedAtMs > 1000) {
        // once per connection, ~1 s after the connect (the client is done with service discovery)
        this->intervalRequestedFor = connects;
        this->requestInterval();
    }
    if(this->loadPeriodMs > 0 && nowMs - this->lastLoadMs >= this->loadPeriodMs) {
        this->lastLoadMs = nowMs;
        this->sendLoad(nowMs);
    }
}

// ---------------------------------------------------------------- peripheral

void BleEspNowTest::onScheduledArm(int64_t leadUs) {
    this->scheduledArms++;
    if(leadUs <= 0) {
        this->lateArms++;
    }
    if(leadUs < this->armLeadUsMin) {
        this->armLeadUsMin = leadUs;
    }
}

void BleEspNowTest::onScheduledStart(int64_t lateUs) {
    this->starts++;
    this->startLateUsSum += lateUs;
    if(lateUs > this->startLateUsMax) {
        this->startLateUsMax = lateUs;
    }
}

// ---------------------------------------------------------------- status / op

void BleEspNowTest::resetCounters() {
    this->loadSent = 0;
    this->intervalRequests = 0;
    this->loopGapUsMax = 0;
    this->loopGaps2ms = 0;
    this->loopGaps10ms = 0;
    this->lastServiceUs = 0;
    this->scheduledArms = 0;
    this->lateArms = 0;
    this->armLeadUsMin = INT64_MAX;
    this->starts = 0;
    this->startLateUsMax = 0;
    this->startLateUsSum = 0;
    connects = connected ? 1 : 0;
    this->intervalRequestedFor = connects;  // do not request again only because of the reset
    disconnects = 0;
    gameDisconnects = 0;
    paramUpdates = 0;
    paramRejects = 0;
    indicateOk = 0;
    indicateTimeouts = 0;
    indicateFailed = 0;
    txLines = 0;
    txBytes = 0;
    txDropped = 0;
    txWaitUsMax = 0;
    txSendUsMax = 0;
    txSendUsAvg = 0;
    EspNowLink::get().resetStats();
}

void BleEspNowTest::describe(JsonObject status, bool central) {
    status["testBuild"] = "bleEspNowTest";

    JsonObject heap = status["heap"].to<JsonObject>();
    heap["free"] = (uint32_t)esp_get_free_heap_size();
    heap["minFree"] = (uint32_t)esp_get_minimum_free_heap_size();
    heap["largest"] = (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);

    JsonObject t = status["bleTest"].to<JsonObject>();
    if(!central) {
        t["scheduledArms"] = this->scheduledArms;
        t["lateArms"] = this->lateArms;
        t["armLeadUsMin"] = this->scheduledArms > 0 ? this->armLeadUsMin : 0;
        t["starts"] = this->starts;
        t["startLateUsMax"] = this->startLateUsMax;
        t["startLateUsAvg"] = this->starts > 0 ? this->startLateUsSum / (int64_t)this->starts : 0;
        return;
    }

    JsonObject ble = status["ble"].to<JsonObject>();
    ble["on"] = this->bleOn;
    ble["connected"] = this->bleOn && (bool)connected;
    uint16_t interval = connInterval;
    ble["intervalMs"] = interval * 1.25;    // 0 = not known yet (no parameter update seen)
    ble["latency"] = (uint32_t)connLatency;
    ble["timeoutMs"] = (uint32_t)connTimeout * 10;

    int64_t busySince = txBusySinceUs;
    int64_t nowUs = esp_timer_get_time();
    t["keepBle"] = this->keepBle;
    t["requestIntervalMs"] = this->intervalMs;
    t["loadBytes"] = this->loadBytes;
    t["loadPeriodMs"] = this->loadPeriodMs;
    t["connects"] = (uint32_t)connects;
    t["disconnects"] = (uint32_t)disconnects;
    t["gameDisconnects"] = (uint32_t)gameDisconnects;
    t["lastDisconnectReason"] = (uint32_t)lastDisconnectReason;
    t["intervalRequests"] = this->intervalRequests;
    t["paramUpdates"] = (uint32_t)paramUpdates;
    t["paramRejects"] = (uint32_t)paramRejects;
    t["loadSent"] = this->loadSent;
    t["txLines"] = (uint32_t)txLines;
    t["txBytes"] = (uint32_t)txBytes;
    t["txDropped"] = (uint32_t)txDropped;
    t["txQueued"] = txQueue != nullptr ? (uint32_t)uxQueueMessagesWaiting(txQueue) : 0;
    t["txWaitUsMax"] = (uint32_t)txWaitUsMax;
    t["txSendUsAvg"] = (uint32_t)txSendUsAvg;
    t["txSendUsMax"] = (uint32_t)txSendUsMax;
    t["txBusyMs"] = busySince != 0 ? usSince(busySince, nowUs) / 1000 : 0;
    t["indicateOk"] = (uint32_t)indicateOk;
    t["indicateTimeouts"] = (uint32_t)indicateTimeouts;
    t["indicateFailed"] = (uint32_t)indicateFailed;
    t["loopGapUsMax"] = this->loopGapUsMax;
    t["loopGaps2ms"] = this->loopGaps2ms;
    t["loopGaps10ms"] = this->loopGaps10ms;
}

void BleEspNowTest::control(JsonObjectConst request, JsonDocument& response, bool central) {
    if(central) {
        if(request["keepBle"].is<bool>()) {
            this->keepBle = request["keepBle"].as<bool>();     // used at the next select
        }
        if(request["intervalMs"].is<int>()) {
            this->intervalMs = (uint16_t)constrain(request["intervalMs"].as<int>(), 0, 4000);
            this->intervalRequestedFor = 0;                     // request again on this connection
        }
        if(request["loadBytes"].is<int>()) {
            this->loadBytes = (uint16_t)constrain(request["loadBytes"].as<int>(), 0, 4000);
        }
        if(request["loadPeriodMs"].is<int>()) {
            this->loadPeriodMs = (uint32_t)constrain(request["loadPeriodMs"].as<int>(), 0, 600000);
        }
    }
    if(request["reset"].is<bool>() && request["reset"].as<bool>()) {
        this->resetCounters();
    }
    response["ok"] = true;
    response["tMs"] = millis();
    if(!(request["brief"].is<bool>() && request["brief"].as<bool>())) {
        this->describe(response.as<JsonObject>(), central);   // "brief": a short answer, for latency pings
    }
}

#endif
