#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>

class BLECharacteristic;

/**
 * BLE GATT server for a phone / configuration software. Available on the central only
 * while the program menu is shown. It is shut down before the pod link (ESP-NOW)
 * starts, so the two radios never run at the same time.
 *
 * Characteristics (service SERVICE_UUID):
 *   MaxLoop   (CHAR_MAX_LOOP_UUID)  W/R      ASCII number > 0 overrides MAX_LOOPS of the next program
 *   Command   (CHAR_COMMAND_UUID)   W/W-NR   JSON requests, each terminated by '\n'
 *   Response  (CHAR_RESPONSE_UUID)  indicate JSON responses, each terminated by '\n'
 *
 * Requests and responses may be split over several BLE writes / indications; the
 * receiver collects bytes until '\n'. Operations: info, list, get, put, delete, validate.
 * See doc/config-api.md.
 */
class PhoneConfig {
    public:
        void start();
        void stop();

        // Handles received requests. Call once per loop pass while in the menu.
        void service();

        // Returns true and sets maxLoops if the phone wrote a valid number > 0
        bool getMaxLoops(int64_t& maxLoops) const;

        // true once after a program file was added, changed or deleted
        bool takeStoreChanged();

    private:
        static const size_t MAX_REQUEST = 12288;
        static const size_t MAX_GET_CHUNK = 4096;
        static const uint8_t UPLOAD_SLOT = 0;

        void handleRequest(const std::string& line);
        void sendResponse(JsonDocument& response);
        void sendError(JsonDocument& response, const char* code, const String& message);

        void opInfo(JsonDocument& response);
        void opList(JsonDocument& response);
        void opGet(JsonObjectConst request, JsonDocument& response);
        void opPut(JsonObjectConst request, JsonDocument& response);
        void opDelete(JsonObjectConst request, JsonDocument& response);
        void opValidate(JsonObjectConst request, JsonDocument& response);

        BLECharacteristic* maxLoopCharacteristic = nullptr;
        BLECharacteristic* commandCharacteristic = nullptr;
        BLECharacteristic* responseCharacteristic = nullptr;
        bool running = false;

        std::string line;
        bool discarding = false;

        bool uploadActive = false;
        std::string uploadPath;
        uint32_t uploadOffset = 0;

        bool storeChanged = false;
};
