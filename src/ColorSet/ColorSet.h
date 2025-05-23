#pragma once

#include <Arduino.h>

struct ColorSet {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
};

static ColorSet* RED;
static ColorSet* GREEN;
static ColorSet* BLUE;
static ColorSet* YELLOW;
static ColorSet* MAGENTA;
static ColorSet* CYAN;
static ColorSet* WHITE;