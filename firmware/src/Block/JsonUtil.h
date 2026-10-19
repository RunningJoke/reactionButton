#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include "ColorSet/ColorSet.h"

namespace JsonUtil {

    // Parses "red" / "off" / "#RRGGBB" / [r, g, b]. Returns false if invalid.
    bool parseColor(JsonVariantConst json, ColorSet& color);

    // Parses a colour name into the colour index used on the BLE link
    // (0 red, 1 green, 2 blue, 3 yellow, 4 magenta, 5 cyan, 6 white, 255 off).
    // Peripherals only understand these, so arbitrary RGB is rejected.
    bool parseRemoteColor(JsonVariantConst json, uint8_t& colorId);

    // Copies a JSON string into out. Returns false if the field is missing / not a string.
    bool getString(JsonVariantConst json, std::string& out);
}
