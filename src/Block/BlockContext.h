#pragma once

#include <Arduino.h>
#include "VariableManager/VariableManager.h"
#include "LEDManager/LEDManager.h"
#include "Input/Button.h"
#include "Results/Results.h"

class IBuzzerMode;

/**
 * Everything a block may use at runtime. Passed into enter/execute/exit so blocks do not
 * reach for singletons themselves (easier to test, easier to see dependencies).
 */
struct BlockContext {
    VariableManager& vars;
    LEDManager& leds;
    Button& button;
    Results& results;
    IBuzzerMode* remote;    // connected peripherals, nullptr if none

    // Pod id of the central itself. Peripherals are 0 .. centralPodId-1.
    uint8_t centralPodId;
};
