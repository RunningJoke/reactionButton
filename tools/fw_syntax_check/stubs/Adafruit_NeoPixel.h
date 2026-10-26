// Stub: Adafruit_NeoPixel 1.12.x (the calls the LED manager uses).
#pragma once
#include <stdint.h>
#include "Arduino.h"

#define NEO_RGB ((0 << 6) | (0 << 4) | (1 << 2) | (2))
#define NEO_GRB ((1 << 6) | (1 << 4) | (0 << 2) | (2))
#define NEO_KHZ400 0x0100
#define NEO_KHZ800 0x0000

typedef uint16_t neoPixelType;

class Adafruit_NeoPixel {
public:
    Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800) { (void)n; (void)pin; (void)type; }
    Adafruit_NeoPixel() {}
    ~Adafruit_NeoPixel() {}
    void begin() {}
    void show() {}
    void setPin(int16_t) {}
    void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b) { (void)n; (void)r; (void)g; (void)b; }
    void setPixelColor(uint16_t n, uint32_t c) { (void)n; (void)c; }
    void fill(uint32_t c = 0, uint16_t first = 0, uint16_t count = 0) { (void)c; (void)first; (void)count; }
    void setBrightness(uint8_t) {}
    uint8_t getBrightness() const { return 0; }
    void clear() {}
    void updateLength(uint16_t) {}
    uint32_t getPixelColor(uint16_t n) const { (void)n; return 0; }
    uint16_t numPixels() const { return 0; }
    static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) { return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }
    static uint32_t Color(uint8_t r, uint8_t g, uint8_t b, uint8_t w) { return ((uint32_t)w << 24) | ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }
};
