#pragma once

#include <Arduino.h>

struct ColorSet {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
};

static ColorSet* RED = new ColorSet{255,0,0};
static ColorSet* GREEN = new ColorSet{0,255,0};
static ColorSet* BLUE = new ColorSet{0,0,255};
static ColorSet* YELLOW = new ColorSet{255,255,0};
static ColorSet* MAGENTA = new ColorSet{255,0,255};
static ColorSet* CYAN = new ColorSet{0,255,255};
static ColorSet* WHITE = new ColorSet{255,255,255};