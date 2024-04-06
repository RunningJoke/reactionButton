#pragma once

#include <Arduino.h>
#include <LEDManager/LEDManager.h>

class VMode {
    public:
        virtual void run(uint64_t timestamp) = 0;
        virtual void reset() = 0;

    protected:
        LEDManager* ledManager;
        void blink(ColorSet* color, uint8_t repetitions);
};