#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "ColorSet/ColorSet.h"

#define LED_PIN 7
#define NEOPIXEL_SIZE 18

struct LEDPaletteID {
    uint64_t bitmask;

    LEDPaletteID(int palette[18]) {
        this->bitmask = 0;
        for(int i = 0; i < NEOPIXEL_SIZE; i++) {
            this->setPaletteID(i,palette[i]);
        }
    }

    void setPaletteID(int led, uint8_t paletteId) {
        this->bitmask &= ~(0x7ULL << (3*led));           // Clear the 3 bits
        this->bitmask |= (uint64_t(paletteId & 0x7) << (3*led)); // Set new value
    };
    uint8_t getPaletteID(int i) {
        return (this->bitmask >> (3*i)) & 0x7;
    }
};

class LEDAnimation {
    public:
        virtual void animate(uint64_t timestamp) = 0;
};

struct LEDPattern {
    ColorSet* palette[8];
    LEDPaletteID* ids;
    LEDAnimation* animation;
};

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
        void setLEDColors(LEDPattern* pattern);
        void turnOff();

        
};