#include "DelayBlock.h"
#include "Block/RandomUtil.h"

namespace {
    // Peripherals start the countdown together with the central this long after the block is entered
    const int64_t COUNTDOWN_LEAD_MS = 20;
}

bool DelayBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->countdown.parse(json, ctx)) {
        return false;
    }
    if(!this->countdownTarget.parse(json["countdownTarget"], ctx.vars)) {
        return ctx.fail("invalid 'countdownTarget' (central, all, peripherals or a pod id)");
    }
    if(!json["ms"].isNull()) {
        if(!this->minMs.parse(json["ms"], ctx.vars)) {
            return ctx.fail("invalid 'ms'");
        }
        this->maxMs = this->minMs;
        return true;
    }
    if(!this->minMs.parse(json["minMs"], ctx.vars) || !this->maxMs.parse(json["maxMs"], ctx.vars)
        || !this->minMs.isSet() || !this->maxMs.isSet()) {
        return ctx.fail("needs 'ms' or 'minMs' + 'maxMs'");
    }
    return true;
}

void DelayBlock::enter(BlockContext& ctx) {
    int64_t duration = RandomUtil::between(this->minMs.get(ctx.vars), this->maxMs.get(ctx.vars));
    this->until = millis() + (uint32_t)duration;

    this->centralCounting = false;
    Protocol::EffectDesc effect;
    if(!this->countdown.active() || duration <= 0) {
        return;
    }
    // the peripherals start a little later, so that all rings are in step; the countdown still ends with the delay
    int64_t lead = this->countdownTarget.includesPeripherals() && duration > COUNTDOWN_LEAD_MS ? COUNTDOWN_LEAD_MS : 0;
    if(this->countdown.describe(this->countdown.fromColor, (uint32_t)(duration - lead), effect)) {
        int64_t startAtUs = lead > 0 ? EffectTarget::nowUs(ctx) + lead * 1000 : 0;
        this->countdownTarget.play(ctx, effect, startAtUs, LEDManager::ALL_LEDS, false);
        this->centralCounting = this->countdownTarget.includesCentral(ctx);
    }
}

void DelayBlock::exit(BlockContext& ctx) {
    if(this->centralCounting) {
        ctx.leds.stopEffect();      // the ring keeps its last frame
        this->centralCounting = false;
    }
}

BlockStatus DelayBlock::execute(BlockContext& ctx) {
    if((int32_t)(millis() - this->until) >= 0) {
        return BlockStatus::done();
    }
    return BlockStatus::running();
}
