#include "ChargeBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"

using namespace Protocol;

static const char* TAG = "CHARGE";

namespace {
    uint32_t clampMs(int64_t value) {
        return value <= 0 ? 0 : (value > (int64_t)UINT32_MAX ? UINT32_MAX : (uint32_t)value);
    }
}

const char* ChargeBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "released", "early", "full", "timeout"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool ChargeBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->parsePod(json["pod"], ctx.vars)) {
        return ctx.fail("invalid 'pod' (\"central\" or a peripheral id)");
    }
    if(!this->onsetMs.parse(json["onsetMs"], ctx.vars) || !this->decayMs.parse(json["decayMs"], ctx.vars)) {
        return ctx.fail("invalid 'onsetMs' or 'decayMs'");
    }
    if(!this->maxMs.parse(json["maxMs"], ctx.vars) || !this->maxMs.isSet()) {
        return ctx.fail("missing 'maxMs'");
    }

    if(!json["style"].isNull()) {
        const char* style = json["style"].as<const char*>();
        if(style == nullptr) return ctx.fail("invalid 'style'");
        if(strcmp(style, "fill") == 0) this->style = Style::FILL;
        else if(strcmp(style, "brightness") == 0) this->style = Style::BRIGHTNESS;
        else if(strcmp(style, "trafficLight") == 0) this->style = Style::TRAFFIC_LIGHT;
        else if(strcmp(style, "colorShift") == 0) this->style = Style::COLOR_SHIFT;
        else return ctx.fail("'style' must be fill, brightness, trafficLight or colorShift");
    }
    if(!json["color"].isNull() && !JsonUtil::parseRemoteColor(json["color"], this->color)) {
        return ctx.fail("invalid 'color' (named colours only)");
    }
    if(!json["color2"].isNull() && !JsonUtil::parseRemoteColor(json["color2"], this->color2)) {
        return ctx.fail("invalid 'color2' (named colours only)");
    }

    const char* mode = json["mode"] | "release";
    if(strcmp(mode, "accumulate") == 0) {
        this->accumulate = true;
    } else if(strcmp(mode, "release") != 0) {
        return ctx.fail("'mode' must be 'release' or 'accumulate'");
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
    const char* storePercent = json["storePercent"];
    if(storePercent != nullptr) {
        this->storePercentVar = ctx.vars.resolve(storePercent);
    }
    return true;
}

void ChargeBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->waitingForLimit = false;
    this->timeout = this->minTimeoutMs.isSet()
        ? clampMs(RandomUtil::between(this->minTimeoutMs.get(ctx.vars), this->maxTimeoutMs.get(ctx.vars))) : 0;
    this->maxChargeMs = clampMs(this->maxMs.get(ctx.vars));
    if(this->maxChargeMs < 1) {
        this->maxChargeMs = 1;
    }

    ArmCommand command;
    command.mode = PodMode::CHARGE;
    command.colorAfter = Color::OFF;

    HoldParams& hold = command.hold;
    hold.flags = this->accumulate ? HOLD_FLAG_ACCUMULATE : 0;
    hold.onsetMs = clampMs(this->onsetMs.get(ctx.vars));
    hold.maxMs = this->maxChargeMs;
    hold.decayMs = this->accumulate ? clampMs(this->decayMs.get(ctx.vars)) : 0;
    hold.limitMs = this->accumulate ? this->timeout : 0;

    // the charge: an effect over maxMs; the pod shows it for the charge it has
    EffectDesc& charge = hold.effect;
    charge = EffectDesc{EffectId::NONE, this->color, Color::OFF, 255, this->maxChargeMs, 0, 0, 0};
    switch(this->style) {
        case Style::FILL:
            charge.effect = EffectId::FILL;
            break;
        case Style::BRIGHTNESS:
            charge.effect = EffectId::DIM;      // DIM_LEVEL -> full brightness
            charge.param = DIM_LEVEL;
            break;
        case Style::TRAFFIC_LIGHT:
            charge.effect = EffectId::TRAFFIC_LIGHT;
            charge.color = Color::RED;          // colour of the full-charge flash
            break;
        case Style::COLOR_SHIFT:
            charge.effect = EffectId::COLOR_SHIFT;
            charge.color2 = this->color2;
            break;
    }

    // the idle ring (no hold yet): the start frame of the charge, or the countdown over the timeout
    command.colorActive = this->style == Style::FILL ? (uint8_t)Color::OFF
                        : this->style == Style::TRAFFIC_LIGHT ? (uint8_t)Color::GREEN : this->color;
    if(this->timeout > 0 && this->countdown.describe(this->color, this->timeout, command.waiting)) {
        // countdown
    } else if(this->style == Style::BRIGHTNESS) {
        command.waiting = EffectDesc{EffectId::SOLID, this->color, Color::OFF, DIM_LEVEL, 0, 0, 0, 0};
    }

    this->armed = this->startHold(ctx, command);
}

BlockStatus ChargeBlock::execute(BlockContext& ctx) {
    if(!this->armed) {
        return BlockStatus::done(TIMEOUT);      // the pod does not exist or cannot measure holds
    }

    HoldEvent event;
    while(this->pollHold(ctx, event)) {
        if(event.kind != HoldEvent::Kind::RELEASED) {
            continue;       // a hold started: the pod shows it, nothing to do here
        }
        if(event.flags & RELEASED_FLAG_FULL) {
            this->finish(ctx, this->maxChargeMs);
            this->stopHold(ctx, true);      // the ring flashes, no reset
            return BlockStatus::done(FULL);
        }
        uint32_t chargeMs = event.chargeMs > this->maxChargeMs ? this->maxChargeMs : event.chargeMs;
        this->finish(ctx, chargeMs);
        this->stopHold(ctx, false);
        if(event.flags & RELEASED_FLAG_LIMIT) {
            return BlockStatus::done(TIMEOUT);
        }
        return BlockStatus::done((event.flags & RELEASED_FLAG_EARLY) && this->isConnected(EARLY) ? EARLY : RELEASED);
    }

    if(this->timeout > 0 && millis() - this->enterTime >= this->timeout) {
        if(this->accumulate) {
            // the pod reports its charge at the limit: wait a moment for that frame
            if(!this->waitingForLimit) {
                this->waitingForLimit = true;
                this->limitDeadline = millis() + LIMIT_GRACE_MS;
            }
            if((int32_t)(millis() - this->limitDeadline) < 0) {
                return BlockStatus::running();
            }
            ESP_LOGW(TAG, "%s: no final report from the pod, charge not stored", this->getName().c_str());
        }
        this->stopHold(ctx, false);
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}

// Stores / records the charge at the end of the block
void ChargeBlock::finish(BlockContext& ctx, uint32_t chargeMs) {
    if(this->storeVar >= 0) {
        ctx.vars.set(this->storeVar, chargeMs);
    }
    if(this->storePercentVar >= 0) {
        ctx.vars.set(this->storePercentVar, ((int64_t)chargeMs * 100 + this->maxChargeMs / 2) / this->maxChargeMs);
    }
    if(!this->recordMetric.empty()) {
        ctx.results.record(this->recordMetric.c_str(), this->resultPodId(ctx), (int32_t)chargeMs);
    }
}
