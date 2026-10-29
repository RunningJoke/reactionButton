#pragma once

#include <Arduino.h>
#include <string>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>
#include "Config/ConfigApi.h"

class BLECharacteristic;

/**
 * BLE transport of the configuration API for a phone / configuration software.
 * On the central it stays on from the program menu through the game (ADR 0005, liveBle):
 * a selected program keeps the phone connected. Advertising stops while a phone is connected
 * and restarts when it disconnects.
 *
 * Characteristics (service SERVICE_UUID):
 *   MaxLoop   (CHAR_MAX_LOOP_UUID)  W/R      ASCII number > 0 overrides MAX_LOOPS of the next program
 *   Command   (CHAR_COMMAND_UUID)   W/W-NR   JSON requests, each terminated by '\n'
 *   Response  (CHAR_RESPONSE_UUID)  indicate JSON responses and report events, each terminated by '\n'
 *
 * Requests and responses may be split over several BLE writes / indications; the
 * receiver collects bytes until '\n'. Responses and events are queued and indicated by a
 * sender task, so the game loop never waits for a confirmation.
 *
 * Advertised name: "ReactPod <last 4 hex digits of the set id>", or "ReactPod <set name>"
 * if a set name was stored with the setName op. The manufacturer data carries the set id. The operations are those of ConfigApi
 * (see docs/firmware/config-api.md); the same API is available on the USB serial port.
 */
class PhoneConfig {
    public:
        PhoneConfig();

        void start();

        // A program was selected: BLE stays on, the connection moves to the game interval
        void enterGame();

        // Handles received requests. Call once per loop pass.
        void service();

        // Returns true and sets maxLoops if the phone wrote a valid number > 0
        bool getMaxLoops(int64_t& maxLoops) const;

        // "ble" part of the central status: connected, intervalMs (0 = not known yet)
        void describe(JsonObject out) const;

        // A phone is connected (and the configuration service is running)
        bool connected() const;

        // Queues a report event for the connected phone (dropped if none is connected).
        // Never waits: the sender task indicates it.
        static void publishEvent(JsonDocument& event);

    private:
        static const uint8_t UPLOAD_SLOT = 0;

        void sendLine(const std::string& text);
        void indicateLine(const std::string& out);
        void requestGameInterval();
        void configureAdvertising(uint32_t setId, const std::string& name);
        static std::string advertisedName();
        static void txTask(void* arg);

        ConfigApi api;
        BLECharacteristic* maxLoopCharacteristic = nullptr;
        BLECharacteristic* commandCharacteristic = nullptr;
        BLECharacteristic* responseCharacteristic = nullptr;
        bool running = false;
        bool gameMode = false;              // a program was selected: the phone stays connected
        bool gameIntervalPending = false;   // ask for the game interval on the current connection

        std::string line;
        bool discarding = false;
        uint32_t advertisedRevision = 0;
        uint32_t sessionConnection = 0;
};
