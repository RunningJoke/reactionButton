#include "Countdown.h"
#include "Block/JsonUtil.h"

using Protocol::EffectDesc;
using Protocol::EffectId;

bool Countdown::parse(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!json["countdown"].isNull()) {
        const char* name = json["countdown"].as<const char*>();
        if(name == nullptr) {
            return ctx.fail("invalid 'countdown'");
        }
        if(strcmp(name, "secret") == 0) this->style = Style::SECRET;
        else if(strcmp(name, "drain") == 0) this->style = Style::DRAIN;
        else if(strcmp(name, "fill") == 0) this->style = Style::FILL;
        else if(strcmp(name, "dim") == 0) this->style = Style::DIM;
        else if(strcmp(name, "colorShift") == 0) this->style = Style::COLOR_SHIFT;
        else if(strcmp(name, "trafficLight") == 0) this->style = Style::TRAFFIC_LIGHT;
        else return ctx.fail("'countdown' must be secret, drain, fill, dim, colorShift or trafficLight");
    }
    if(!json["countdownColor"].isNull() && !JsonUtil::parseRemoteColor(json["countdownColor"], this->endColor)) {
        return ctx.fail("invalid 'countdownColor' (named colours only)");
    }
    if(!json["countdownFrom"].isNull() && !JsonUtil::parseRemoteColor(json["countdownFrom"], this->fromColor)) {
        return ctx.fail("invalid 'countdownFrom' (named colours only)");
    }
    return true;
}

bool Countdown::describe(uint8_t litColor, uint32_t durationMs, EffectDesc& out) const {
    if(!this->active() || durationMs == 0) {
        return false;
    }
    out = EffectDesc{EffectId::NONE, litColor, Protocol::Color::OFF, 255, durationMs, 0, 0, 0};
    switch(this->style) {
        case Style::DRAIN:
            out.effect = EffectId::DRAIN;
            break;
        case Style::FILL:
            out.effect = EffectId::FILL;
            break;
        case Style::DIM:
            out.effect = EffectId::DIM;
            out.brightness = 0;         // end brightness
            out.param = 255;            // start brightness
            break;
        case Style::COLOR_SHIFT:
            out.effect = EffectId::COLOR_SHIFT;
            out.color2 = this->endColor;
            break;
        case Style::TRAFFIC_LIGHT:
            out.effect = EffectId::TRAFFIC_LIGHT;
            break;
        default:
            return false;
    }
    return true;
}
