#include "EffectBlock.h"
#include "Block/JsonUtil.h"
#include "LEDManager/LEDManager.h"

using Protocol::EffectDesc;
using Protocol::EffectId;

bool EffectBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->target.parse(json["target"], ctx.vars)) {
        return ctx.fail("invalid 'target' (central, all, peripherals or a pod id)");
    }

    const char* name = json["effect"].as<const char*>();
    if(name == nullptr) {
        return ctx.fail("missing 'effect'");
    }
    if(strcmp(name, "off") == 0) {
        this->off = true;
        this->effect = EffectId::SOLID;
    } else {
        this->effect = LEDManager::effectFromName(name);
        // "none" is not an effect and "level" (a gauge) has no fields in this block
        if(this->effect == EffectId::COUNT_ || this->effect == EffectId::NONE || this->effect == EffectId::LEVEL) {
            return ctx.fail("'effect' must be solid, fill, drain, dim, colorShift, trafficLight, blink, pulse, spin or off");
        }
    }

    if(!json["color"].isNull() && !JsonUtil::parseRemoteColor(json["color"], this->color)) {
        return ctx.fail("invalid 'color' (named colours only)");
    }
    if(!json["color2"].isNull() && !JsonUtil::parseRemoteColor(json["color2"], this->color2)) {
        return ctx.fail("invalid 'color2' (named colours only)");
    }
    if(!this->durationMs.parse(json["durationMs"], ctx.vars) || !this->periodMs.parse(json["periodMs"], ctx.vars)
        || !this->brightness.parse(json["brightness"], ctx.vars) || !this->syncStartMs.parse(json["syncStartMs"], ctx.vars)) {
        return ctx.fail("invalid 'durationMs', 'periodMs', 'brightness' or 'syncStartMs'");
    }

    for(JsonVariantConst led : json["leds"].as<JsonArrayConst>()) {
        uint8_t index = led.as<uint8_t>();
        if(index >= NEOPIXEL_SIZE) {
            return ctx.fail("led index out of range");
        }
        this->ledMask |= 1UL << index;
    }

    this->wait = json["wait"] | false;
    bool periodic = this->effect == EffectId::BLINK || this->effect == EffectId::PULSE || this->effect == EffectId::SPIN;
    if(this->wait && periodic && (!this->durationMs.isSet() || (this->durationMs.isConstant() && this->durationMs.constantValue() <= 0))) {
        return ctx.fail("'wait' with an endless effect (blink, pulse, spin) needs 'durationMs' > 0");
    }
    return true;
}

void EffectBlock::enter(BlockContext& ctx) {
    this->started = false;
}

BlockStatus EffectBlock::execute(BlockContext& ctx) {
    if(!this->started) {
        this->started = true;

        int64_t duration = this->durationMs.isSet() ? this->durationMs.get(ctx.vars) : 0;
        if(duration < 0) duration = 0;
        if(duration > (int64_t)UINT32_MAX) duration = UINT32_MAX;
        int64_t period = this->periodMs.get(ctx.vars);
        int64_t level = constrain(this->brightness.get(ctx.vars), (int64_t)0, (int64_t)255);

        EffectDesc desc = {this->effect, this->color, this->color2, (uint8_t)level, (uint32_t)duration,
                           (uint16_t)(period <= 0 ? 500 : (period > 65535 ? 65535 : period)), 0, 0};
        if(this->off) {
            desc.color = Protocol::Color::OFF;
            desc.brightness = 255;
        } else if(this->effect == EffectId::DIM) {
            // from brightness down to dark
            desc.param = (uint8_t)level;
            desc.brightness = 0;
        }

        // all targets start together, lead time for the commands to arrive
        int64_t lead = this->syncStartMs.get(ctx.vars);
        if(lead < 0) lead = 0;
        int64_t startAtUs = EffectTarget::nowUs(ctx) + lead * 1000;
        this->target.play(ctx, desc, lead > 0 ? startAtUs : 0, this->ledMask != 0 ? this->ledMask : LEDManager::ALL_LEDS, true);

        if(!this->wait) {
            return BlockStatus::done();
        }
        this->endUs = startAtUs + duration * 1000;
    }

    return EffectTarget::nowUs(ctx) >= this->endUs ? BlockStatus::done() : BlockStatus::running();
}
