#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "ColorSet/ColorSet.h"

#define NEOPIXEL_SIZE 18

class LEDManager {
    protected:
        ColorSet* pOffConfiguration;
        ColorSet* pCurrentColorConfiguration;

        uint8_t neoPixelPin;
        Adafruit_NeoPixel* pixelManager;
    public:
        LEDManager(uint8_t neoPixelPin);
        void setLEDColors(ColorSet* pNewColorSet);
        void setLEDColors(uint8_t colorId);
        void setLEDColors(uint8_t index, ColorSet* pNewColorSet);
        void turnOff();

        
};