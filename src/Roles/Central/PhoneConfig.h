#pragma once

#include <Arduino.h>

class BLECharacteristic;

/**
 * BLE GATT server for a phone, available on the central only while the program menu is
 * shown. It is shut down before the pod link (ESP-NOW) starts, so the two radios never
 * run at the same time.
 *
 * Characteristics:
 *   MaxLoop (CHAR_MAX_LOOP_UUID)  ASCII number > 0 overrides MAX_LOOPS of the selected program
 */
class PhoneConfig {
    public:
        void start();
        void stop();

        // Returns true and sets maxLoops if the phone wrote a valid number > 0
        bool getMaxLoops(int64_t& maxLoops) const;

    private:
        BLECharacteristic* maxLoopCharacteristic = nullptr;
        bool running = false;
};
