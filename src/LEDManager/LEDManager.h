#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "ColorSet/ColorSet.h"

#define LED_PIN 19
#define NEOPIXEL_SIZE 18

class LEDManager {
    protected:
        ColorSet* pOffConfiguration;
        ColorSet* pCurrentColorConfiguration;

        uint8_t neoPixelPin;
        Adafruit_NeoPixel* pixelManager;

        static LEDManager* manager;
        LEDManager(uint8_t neoPixelPin);
    public:
        static LEDManager* getManager();
        void setLEDColors(ColorSet* pNewColorSet);
        void setLEDColors(uint8_t colorId);
        void setLEDColors(uint8_t index, ColorSet* pNewColorSet);
        void turnOff();

        
};