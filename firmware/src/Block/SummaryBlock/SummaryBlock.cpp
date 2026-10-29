#include "SummaryBlock.h"
#include "Config/Console.h"
#include "Block/JsonUtil.h"

namespace {
    const int64_t SHOW_MS_DEFAULT = 3000;
    const int64_t MAX_TARGET_MS = 60000;
    const int64_t MAX_SHOW_MS = 60000;
    // the bar is empty at twice the target; a measured value always lights one LED (6 % of 18 LEDs)
    const int64_t MIN_BAR_PERCENT = 6;
}

static VarId optionalVar(JsonVariantConst json, VariableManager& vars) {
    const char* name = json;
    return name != nullptr ? vars.resolve(name) : -1;
}

bool SummaryBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!JsonUtil::getString(json["metric"], this->metric)) {
        return ctx.fail("missing 'metric'");
    }
    this->averageVar = optionalVar(json["storeAverage"], ctx.vars);
    this->bestVar = optionalVar(json["storeBest"], ctx.vars);
    this->worstVar = optionalVar(json["storeWorst"], ctx.vars);
    this->countVar = optionalVar(json["storeCount"], ctx.vars);
    this->reset = json["reset"] | true;

    this->show = json["show"] | false;
    if(this->show) {
        if(!this->targetMs.parse(json["targetMs"], ctx.vars) || !this->targetMs.isSet()) {
            return ctx.fail("'show' needs 'targetMs' (ms)");
        }
        if(this->targetMs.isConstant() && (this->targetMs.constantValue() < 1 || this->targetMs.constantValue() > MAX_TARGET_MS)) {
            return ctx.fail("'targetMs' must be 1 to 60000");
        }
    }
    if(!this->showMs.parse(json["showMs"], ctx.vars)) {
        return ctx.fail("invalid 'showMs'");
    }
    if(!this->showMs.isSet()) {
        this->showMs = Value(SHOW_MS_DEFAULT);
    }
    if(this->showMs.isConstant() && (this->showMs.constantValue() < 0 || this->showMs.constantValue() > MAX_SHOW_MS)) {
        return ctx.fail("'showMs' must be 0 to 60000");
    }
    return true;
}

void SummaryBlock::enter(BlockContext& ctx) {
    this->started = false;
}

void SummaryBlock::resume(BlockContext& ctx) {
    // a pause during the bar keeps the bar: the statistics were reset already
    if(!this->showing) {
        this->enter(ctx);
    }
}

BlockStatus SummaryBlock::execute(BlockContext& ctx) {
    if(!this->started) {
        this->started = true;
        this->collect(ctx);
    }
    if(!this->showing) {
        return BlockStatus::done();
    }
    if((int32_t)(millis() - this->until) >= 0) {
        this->showing = false;
        ctx.leds.turnOff();
        return BlockStatus::done();
    }
    return BlockStatus::running();
}

void SummaryBlock::collect(BlockContext& ctx) {
    Results::Stats s = ctx.results.stats(this->metric.c_str());
    int32_t best = s.count > 0 ? s.min : 0;
    int32_t worst = s.count > 0 ? s.max : 0;

    Console.printf("SUMMARY,%s,%lu,%ld,%ld,%ld\n", this->metric.c_str(),
                  (unsigned long)s.count, (long)s.average(), (long)best, (long)worst);

    if(this->averageVar >= 0) ctx.vars.set(this->averageVar, s.average());
    if(this->bestVar >= 0) ctx.vars.set(this->bestVar, best);
    if(this->worstVar >= 0) ctx.vars.set(this->worstVar, worst);
    if(this->countVar >= 0) ctx.vars.set(this->countVar, s.count);

    if(this->show && s.count > 0) {
        this->showBar(ctx, s.average());
    }
    if(this->reset) {
        ctx.results.reset(this->metric.c_str());
    }
}

void SummaryBlock::showBar(BlockContext& ctx, int32_t average) {
    int64_t target = constrain(this->targetMs.get(ctx.vars), (int64_t)1, MAX_TARGET_MS);
    int64_t twice = 2 * target;

    // full ring at 0 ms, empty at twice the target
    int64_t percent = average >= twice ? 0 : (twice - average) * 100 / twice;
    if(percent < MIN_BAR_PERCENT) {
        percent = MIN_BAR_PERCENT;
    }

    // green: better than the target, amber: up to 1.5 times the target, red: slower
    uint8_t color = average < target ? Protocol::Color::GREEN
                  : (int64_t)average * 2 <= target * 3 ? Protocol::Color::YELLOW
                  : Protocol::Color::RED;

    Protocol::EffectDesc bar = {Protocol::EffectId::LEVEL, color, Protocol::Color::OFF, 255, 0, 0, (uint8_t)percent, 0};
    ctx.leds.playEffect(bar);

    int64_t showMs = constrain(this->showMs.get(ctx.vars), (int64_t)0, MAX_SHOW_MS);
    if(showMs > 0) {
        this->showing = true;
        this->until = millis() + (uint32_t)showMs;
    }
    // showMs 0: the bar stays on the ring until the next LED change, the block does not wait
}
