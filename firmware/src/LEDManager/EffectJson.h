#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Link/Protocol.h"

/**
 * JSON form of an effect (used by the "effect" test op; meant to be reused by the effect
 * block, #55):
 *
 *   {"effect": "fill", "color": "green", "color2": "off", "brightness": 255,
 *    "durationMs": 3000, "periodMs": 1000, "segment": 3, "from": 255, "to": 0,
 *    "value": 50, "reverse": false, "endOff": false}
 *
 * Only "effect" is required. Defaults: color white, color2 off, brightness 255, times 0.
 * "segment" (spin), "from" / "to" (dim, default 255 -> 0) and "value" (level, percent) go
 * into EffectDesc::param / brightness. Colours are the named colours of the link.
 */
namespace EffectJson {

    // Returns false with a message in error if a field is invalid
    bool parse(JsonVariantConst json, Protocol::EffectDesc& out, String& error);
}
