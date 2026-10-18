#pragma once

#include <Arduino.h>
#include <string>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>
#include "Config/ConfigApi.h"

class BLECharacteristic;

/**
 * BLE transport of the configuration API for a phone / configuration software.
 * Available on the central only while the program menu is shown. It is shut down
 * before the pod link (ESP-NOW) starts, so the two radios never run at the same time.
 *
 * Characteristics (service SERVICE_UUID):
 *   MaxLoop   (CHAR_MAX_LOOP_UUID)  W/R      ASCII number > 0 overrides MAX_LOOPS of the next program
 *   Command   (CHAR_COMMAND_UUID)   W/W-NR   JSON requests, each terminated by '\n'
 *   Response  (CHAR_RESPONSE_UUID)  indicate JSON responses, each terminated by '\n'
 *
 * Requests and responses may be split over several BLE writes / indications; the
 * receiver collects bytes until '\n'. The operations are those of ConfigApi
 * (see doc/config-api.md); the same API is available on the USB serial port.
 */
class PhoneConfig {
    public:
        PhoneConfig();

        void start();
        void stop();

        // Handles received requests. Call once per loop pass while in the menu.
        void service();

        // Returns true and sets maxLoops if the phone wrote a valid number > 0
        bool getMaxLoops(int64_t& maxLoops) const;

    private:
        static const uint8_t UPLOAD_SLOT = 0;

        void sendLine(const std::string& text);

        ConfigApi api;
        BLECharacteristic* maxLoopCharacteristic = nullptr;
        BLECharacteristic* commandCharacteristic = nullptr;
        BLECharacteristic* responseCharacteristic = nullptr;
        bool running = false;

        std::string line;
        bool discarding = false;
};
