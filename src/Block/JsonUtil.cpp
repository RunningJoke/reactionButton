#include "JsonUtil.h"
#include <string.h>

namespace {
    struct NamedColor {
        const char* name;
        ColorSet rgb;
        uint8_t remoteId;
    };

    const NamedColor NAMED_COLORS[] = {
        {"off",     {0, 0, 0},       255},
        {"black",   {0, 0, 0},       255},
        {"red",     {255, 0, 0},     0},
        {"green",   {0, 255, 0},     1},
        {"blue",    {0, 0, 255},     2},
        {"yellow",  {255, 255, 0},   3},
        {"magenta", {255, 0, 255},   4},
        {"cyan",    {0, 255, 255},   5},
        {"white",   {255, 255, 255}, 6},
    };

    const NamedColor* findColor(const char* name) {
        for(const NamedColor& c : NAMED_COLORS) {
            if(strcasecmp(c.name, name) == 0) {
                return &c;
            }
        }
        return nullptr;
    }
}

bool JsonUtil::parseColor(JsonVariantConst json, ColorSet& color) {
    if(json.is<const char*>()) {
        const char* s = json.as<const char*>();
        if(s[0] == '#' && strlen(s) == 7) {
            char* end = nullptr;
            uint32_t rgb = strtoul(s + 1, &end, 16);
            if(*end != '\0') {
                return false;
            }
            color = ColorSet{(uint8_t)(rgb >> 16), (uint8_t)(rgb >> 8), (uint8_t)rgb};
            return true;
        }
        const NamedColor* named = findColor(s);
        if(named == nullptr) {
            return false;
        }
        color = named->rgb;
        return true;
    }

    if(json.is<JsonArrayConst>()) {
        JsonArrayConst arr = json.as<JsonArrayConst>();
        if(arr.size() != 3) {
            return false;
        }
        color = ColorSet{arr[0].as<uint8_t>(), arr[1].as<uint8_t>(), arr[2].as<uint8_t>()};
        return true;
    }

    return false;
}

bool JsonUtil::parseRemoteColor(JsonVariantConst json, uint8_t& colorId) {
    if(!json.is<const char*>()) {
        return false;
    }
    const NamedColor* named = findColor(json.as<const char*>());
    if(named == nullptr) {
        return false;
    }
    colorId = named->remoteId;
    return true;
}

bool JsonUtil::getString(JsonVariantConst json, std::string& out) {
    if(!json.is<const char*>()) {
        return false;
    }
    out = json.as<const char*>();
    return true;
}
