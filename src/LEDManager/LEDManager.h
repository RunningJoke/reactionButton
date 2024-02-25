#pragma once

#include <Arduino.h>
#include "ColorSet/ColorSet.h"

class LEDManager {
    protected:
        ColorSet* pOffConfiguration;
        ColorSet* pCurrentColorConfiguration;
        uint8_t pinRedLed;
        uint8_t pinGreenLed;
        uint8_t pinBlueLed;
    public:
        LEDManager(uint8_t pin_red_led, uint8_t pin_green_led, uint8_t pin_blue_led);
        void setLEDColors(ColorSet* pNewColorSet);
        void turnOff();

        static ColorSet* RED;
        static ColorSet* GREEN;
        static ColorSet* BLUE;
        static ColorSet* YELLOW;
        static ColorSet* MAGENTA;
        static ColorSet* CYAN;
        static ColorSet* WHITE;
};