#include "ButtonBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"

const char* ButtonBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "short", "long", "pressed", "timeout"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool ButtonBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->shortMs.parse(json["shortMs"], ctx.vars)) {
        return ctx.fail("invalid 'shortMs'");
    }

    if(!json["timeoutMs"].isNull()) {
        if(!this->minTimeoutMs.parse(json["timeoutMs"], ctx.vars)) {
            return ctx.fail("invalid 'timeoutMs'");
        }
        this->maxTimeoutMs = this->minTimeoutMs;
    } else if(!this->minTimeoutMs.parse(json["minTimeoutMs"], ctx.vars)
            || !this->maxTimeoutMs.parse(json["maxTimeoutMs"], ctx.vars)
            || this->minTimeoutMs.isSet() != this->maxTimeoutMs.isSet()) {
        return ctx.fail("random timeout needs 'minTimeoutMs' and 'maxTimeoutMs'");
    }

    if(!this->countdown.parse(json, ctx)) {
        return false;
    }
    if(this->countdown.active() && !this->minTimeoutMs.isSet()) {
        return ctx.fail("'countdown' needs 'timeoutMs' or 'minTimeoutMs' + 'maxTimeoutMs'");
    }

    JsonUtil::getString(json["record"], this->recordMetric);
    const char* storeAs = json["storeAs"];
    if(storeAs != nullptr) {
        this->storeVar = ctx.vars.resolve(storeAs);
    }
    return true;
}

void ButtonBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->pressCountAtEnter = ctx.button.pressCount();
    this->pressed = false;
    this->timeout = 0;
    if(this->minTimeoutMs.isSet()) {
        this->timeout = (uint32_t)RandomUtil::between(this->minTimeoutMs.get(ctx.vars), this->maxTimeoutMs.get(ctx.vars));
    }

    this->centralCounting = false;
    Protocol::EffectDesc effect;
    if(this->countdown.describe(this->countdown.fromColor, this->timeout, effect)) {
        ctx.leds.playEffect(effect);
        this->centralCounting = true;
    }
}

void ButtonBlock::exit(BlockContext& ctx) {
    if(this->centralCounting) {
        ctx.leds.stopEffect();
        this->centralCounting = false;
    }
}

BlockStatus ButtonBlock::execute(BlockContext& ctx) {
    if(!this->pressed) {
        if(ctx.button.pressCount() == this->pressCountAtEnter) {
            if(this->timeout > 0 && millis() - this->enterTime >= this->timeout) {
                return BlockStatus::done(TIMEOUT);
            }
            return BlockStatus::running();
        }

        this->pressed = true;
        if(this->centralCounting) {
            ctx.leds.stopEffect();      // a press stops the countdown, the ring keeps its last frame
            this->centralCounting = false;
        }
        int32_t reaction = (int32_t)(ctx.button.lastPressTime() - this->enterTime);
        if(!this->recordMetric.empty()) {
            ctx.results.record(this->recordMetric.c_str(), ctx.centralPodId, reaction);
        }
        if(this->storeVar >= 0) {
            ctx.vars.set(this->storeVar, reaction);
        }
        if(this->isConnected(PRESSED)) {
            return BlockStatus::done(PRESSED);
        }
    }

    // pressed, wait for the release to classify short / long
    if(ctx.button.isDown()) {
        return BlockStatus::running();
    }
    return BlockStatus::done(ctx.button.lastHeldMs() < this->shortMs.get(ctx.vars) ? SHORT : LONG);
}
