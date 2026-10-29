#pragma once

#include <Arduino.h>

struct ColorSet {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
};

// One shared instance per colour, defined in ColorSet.cpp. The pointers are constant-initialised
// (no dynamic init), so they are valid in static initialisers of other translation units too.
extern ColorSet* const BLACK;
extern ColorSet* const RED;
extern ColorSet* const GREEN;
extern ColorSet* const BLUE;
extern ColorSet* const YELLOW;
extern ColorSet* const MAGENTA;
extern ColorSet* const CYAN;
extern ColorSet* const WHITE;
extern ColorSet* const ORANGE;
extern ColorSet* const VIOLET;
extern ColorSet* const AMBER;
