#pragma once

/**
 * Hardware test #38: BLE stays connected on the central while ESP-NOW runs.
 *
 * Compiled only in the PlatformIO env "BleEspNowTest" (build flag REACTPOD_BLE_ESPNOW_TEST).
 * In the normal build (NewBoard) this file and BleEspNowTest.cpp are empty, and every hook
 * in CentralRole / PhoneConfig / PeripheralRole is behind the same #ifdef.
 *
 * What the test build changes (central):
 *   - select / long press keeps PhoneConfig running (unless keepBle is switched off), ESP-NOW
 *     starts as usual. Advertising stops while a client is connected (BLE controller) and
 *     restarts on disconnect (PhoneConfig::ServerCallbacks), also during the game.
 *   - in the game, the central requests a long connection interval (intervalMs, default 75 ms)
 *     and a peripheral latency (latency, default 0: connection events the pod may skip while it
 *     has nothing to send) about 1 s after each connect.
 *   - the config API over BLE stays served in every state. Its responses are indicated by a
 *     separate task (priority above the loop), so the game loop never waits for an
 *     indication confirmation.
 *   - optional load: every loadPeriodMs one {"event":"load",...} line of loadBytes bytes is
 *     indicated (stands in for a live report per round).
 *   - status gets "heap", "ble" and "bleTest" (counters, loop gaps).
 * Peripheral: counts scheduled ARMs that arrived late and the start error (status "bleTest").
 *
 * Config op (USB serial or BLE): {"op":"bleTest", "keepBle":true, "intervalMs":75, "latency":0,
 *   "loadBytes":1024, "loadPeriodMs":2000, "reset":true}; every field optional.
 * See docs/firmware/testing.md §8 and tools/ble_espnow_test.py.
 */
#ifdef REACTPOD_BLE_ESPNOW_TEST

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>

class PhoneConfig;
class BLECharacteristic;

class BleEspNowTest {
    public:
        static BleEspNowTest& get();

        // ---- central
        // Before PhoneConfig::start(): installs the BLE event hooks and the indication task
        void begin(PhoneConfig* phone);
        // PhoneConfig::start(): counts the indication results of the Response characteristic
        void attachResponse(BLECharacteristic* response);
        // Program selected. Returns true if BLE stays on (the caller then skips PhoneConfig::stop)
        bool enterGame();
        // Once per loop pass of the central
        void service();
        // PhoneConfig::sendLine: true = the line (with '\n') was handed to the indication task
        bool queueLine(const std::string& line);

        // ---- peripheral
        void onScheduledArm(int64_t leadUs);     // ARM with start time: scheduled - now (< 0 = late)
        void onScheduledStart(int64_t lateUs);   // LEDs on: activation - scheduled time

        // ---- both roles
        void describe(JsonObject status, bool central);
        void control(JsonObjectConst request, JsonDocument& response, bool central);

    private:
        BleEspNowTest() {}

        void resetCounters();
        void requestInterval();
        void sendLoad(uint32_t nowMs);
        static void txTask(void* arg);

        PhoneConfig* phone = nullptr;

        // settings (RAM, back to the defaults after every restart)
        bool keepBle = true;
        uint16_t intervalMs = 75;           // 0 = do not request
        uint16_t latency = 0;               // peripheral latency (connection events), with intervalMs
        uint16_t loadBytes = 1024;
        uint32_t loadPeriodMs = 0;          // 0 = no load lines

        bool bleOn = true;                  // false after PhoneConfig::stop (keepBle off)
        bool inGame = false;
        uint32_t intervalRequestedFor = 0;  // connect counter of the last request
        uint32_t lastLoadMs = 0;
        uint32_t loadSeq = 0;
        int64_t lastServiceUs = 0;

        // central counters
        uint32_t loadSent = 0;
        uint32_t intervalRequests = 0;
        uint32_t loopGapUsMax = 0;
        uint32_t loopGaps2ms = 0;
        uint32_t loopGaps10ms = 0;

        // peripheral counters
        uint32_t scheduledArms = 0;
        uint32_t lateArms = 0;
        int64_t armLeadUsMin = INT64_MAX;
        uint32_t starts = 0;
        int64_t startLateUsMax = 0;
        int64_t startLateUsSum = 0;
};

#endif
