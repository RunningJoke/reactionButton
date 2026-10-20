#include "EffectJson.h"
#include "LEDManager/LEDManager.h"
#include "Block/JsonUtil.h"

using Protocol::EffectDesc;
using Protocol::EffectId;

namespace {
    bool color(JsonVariantConst json, const char* key, uint8_t& out, String& error) {
        JsonVariantConst value = json[key];
        if(value.isNull()) {
            return true;
        }
        if(!JsonUtil::parseRemoteColor(value, out)) {
            error = String("'") + key + "' must be a colour name (red, green, blue, yellow, magenta, cyan, white, off)";
            return false;
        }
        return true;
    }

    template<typename T>
    bool number(JsonVariantConst json, const char* key, T& out, String& error) {
        JsonVariantConst value = json[key];
        if(value.isNull()) {
            return true;
        }
        if(!value.is<T>()) {
            error = String("'") + key + "' is not a number in range";
            return false;
        }
        out = value.as<T>();
        return true;
    }
}

bool EffectJson::parse(JsonVariantConst json, EffectDesc& out, String& error) {
    const char* name = json["effect"].as<const char*>();
    if(name == nullptr) {
        error = "'effect' missing";
        return false;
    }
    EffectId id = LEDManager::effectFromName(name);
    if(id == EffectId::COUNT_) {
        error = String("unknown effect '") + name + "'";
        return false;
    }

    out = EffectDesc{id, Protocol::Color::WHITE, Protocol::Color::OFF, 255, 0, 0, 0, 0};
    uint8_t color1 = Protocol::Color::WHITE;
    uint8_t color2 = Protocol::Color::OFF;
    uint8_t brightness = 255;
    uint32_t durationMs = 0;
    uint16_t periodMs = 0;
    uint8_t param = 0;
    if(!color(json, "color", color1, error) || !color(json, "color2", color2, error)
        || !number(json, "brightness", brightness, error)
        || !number(json, "durationMs", durationMs, error)
        || !number(json, "periodMs", periodMs, error)) {
        return false;
    }

    switch(id) {
        case EffectId::SPIN:
            if(!number(json, "segment", param, error)) return false;
            break;
        case EffectId::LEVEL:
            if(!number(json, "value", param, error)) return false;
            if(param > 100) {
                error = "'value' is a percentage (0..100)";
                return false;
            }
            break;
        case EffectId::DIM:
            param = 255;
            brightness = 0;
            if(!number(json, "from", param, error) || !number(json, "to", brightness, error)) return false;
            break;
        default:
            break;
    }

    out.color = color1;
    out.color2 = color2;
    out.brightness = brightness;
    out.durationMs = durationMs;
    out.periodMs = periodMs;
    out.param = param;
    if(json["reverse"].as<bool>()) out.flags |= Protocol::EFFECT_FLAG_REVERSE;
    if(json["endOff"].as<bool>()) out.flags |= Protocol::EFFECT_FLAG_END_OFF;
    return true;
}
