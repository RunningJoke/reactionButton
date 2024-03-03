#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "ColorSet/ColorSet.h"

#define NEOPIXEL_SIZE 16

class LEDManager {
    protected:
        ColorSet* pOffConfiguration;
        ColorSet* pCurrentColorConfiguration;

        uint8_t neoPixelPin;
        Adafruit_NeoPixel* pixelManager;
    public:
        LEDManager(uint8_t neoPixelPin);
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