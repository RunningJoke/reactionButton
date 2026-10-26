#include "ReleaseBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"

using namespace Protocol;

namespace {
    uint32_t clampMs(int64_t value) {
        return value <= 0 ? 0 : (value > (int64_t)UINT32_MAX ? UINT32_MAX : (uint32_t)value);
    }
}

const char* ReleaseBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "noHold", "falseStart", "timeout"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool ReleaseBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->parsePod(json["pod"], ctx.vars)) {
        return ctx.fail("invalid 'pod' (\"central\" or a peripheral id)");
    }

    const char* mode = json["mode"] | "trigger";
    if(strcmp(mode, "signal") == 0) {
        this->signal = true;
        this->allowHeld = false;
    } else if(strcmp(mode, "trigger") != 0) {
        return ctx.fail("'mode' must be 'trigger' or 'signal'");
    }

    if(!json["holdColor"].isNull() && !JsonUtil::parseRemoteColor(json["holdColor"], this->holdColor)) {
        return ctx.fail("invalid 'holdColor' (named colours only)");
    }
    this->heldColor = this->holdColor;
    if(!json["heldColor"].isNull() && !JsonUtil::parseRemoteColor(json["heldColor"], this->heldColor)) {
        return ctx.fail("invalid 'heldColor' (named colours only)");
    }
    if(!json["goColor"].isNull() && !JsonUtil::parseRemoteColor(json["goColor"], this->goColor)) {
        return ctx.fail("invalid 'goColor' (named colours only)");
    }
    if(!json["allowHeld"].isNull()) {
        if(!json["allowHeld"].is<bool>()) {
            return ctx.fail("'allowHeld' must be true or false");
        }
        this->allowHeld = json["allowHeld"].as<bool>();
    }

    if(!this->holdTimeoutMs.parse(json["holdTimeoutMs"], ctx.vars) || !this->maxHoldMs.parse(json["maxHoldMs"], ctx.vars)
        || !this->timeoutMs.parse(json["timeoutMs"], ctx.vars)) {
        return ctx.fail("invalid 'holdTimeoutMs', 'maxHoldMs' or 'timeoutMs'");
    }

    if(this->signal) {
        if(!json["goMs"].isNull()) {
            if(!this->minGoMs.parse(json["goMs"], ctx.vars)) {
                return ctx.fail("invalid 'goMs'");
            }
            this->maxGoMs = this->minGoMs;
        } else if(!this->minGoMs.parse(json["minGoMs"], ctx.vars) || !this->maxGoMs.parse(json["maxGoMs"], ctx.vars)
                || !this->minGoMs.isSet() || !this->maxGoMs.isSet()) {
            return ctx.fail("signal mode needs 'goMs' or 'minGoMs' + 'maxGoMs'");
        }
    }

    if(!this->countdown.parse(json, ctx)) {
        return false;
    }
    if(this->countdown.active() && !(this->signal ? this->timeoutMs.isSet() : this->maxHoldMs.isSet())) {
        return ctx.fail(this->signal ? "'countdown' needs 'timeoutMs'" : "'countdown' needs 'maxHoldMs'");
    }

    JsonUtil::getString(json["record"], this->recordMetric);
    const char* storeAs = json["storeAs"];
    if(storeAs != nullptr) {
        this->storeVar = ctx.vars.resolve(storeAs);
    }
    return true;
}

void ReleaseBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->holdStarted = false;
    this->holdTimeout = this->holdTimeoutMs.isSet() ? clampMs(this->holdTimeoutMs.get(ctx.vars)) : 0;
    this->maxHold = !this->signal && this->maxHoldMs.isSet() ? clampMs(this->maxHoldMs.get(ctx.vars)) : 0;
    this->goDelay = 0;
    this->timeout = 0;
    if(this->signal) {
        this->goDelay = clampMs(RandomUtil::between(this->minGoMs.get(ctx.vars), this->maxGoMs.get(ctx.vars)));
        this->timeout = this->timeoutMs.isSet() ? clampMs(this->timeoutMs.get(ctx.vars)) : 0;
    }

    ArmCommand command;
    command.mode = PodMode::RELEASE;
    command.colorActive = this->holdColor;
    command.colorAfter = Color::OFF;

    HoldParams& hold = command.hold;
    hold.flags = (this->allowHeld ? HOLD_FLAG_ALLOW_HELD : 0) | (this->signal ? HOLD_FLAG_SIGNAL : 0);
    hold.heldColor = this->heldColor;
    hold.goColor = this->goColor;
    hold.goDelayMs = this->goDelay;
    // countdown: over maxHoldMs from the hold start (trigger), over timeoutMs from the switch (signal)
    if(this->signal) {
        if(this->timeout > 0) {
            this->countdown.describe(this->goColor, this->timeout, hold.effect);
        }
    } else if(this->maxHold > 0) {
        this->countdown.describe(this->heldColor, this->maxHold, hold.effect);
    }

    this->armed = this->startHold(ctx, command);
}

BlockStatus ReleaseBlock::execute(BlockContext& ctx) {
    if(!this->armed) {
        return BlockStatus::done(TIMEOUT);      // the pod does not exist or cannot measure holds
    }

    HoldEvent event;
    while(this->pollHold(ctx, event)) {
        if(event.kind == HoldEvent::Kind::HOLD_STARTED) {
            this->holdStarted = true;
            this->holdStartUs = event.atUs;
            continue;
        }

        // the hold ended; the block is left at the time this event arrived on the central
        this->stopHold(ctx, false);
        if(!this->signal) {
            if(this->storeVar >= 0) {
                ctx.vars.set(this->storeVar, event.heldMs);
            }
            return BlockStatus::done(NEXT);
        }
        if(event.flags & RELEASED_FLAG_FALSE_START) {
            return BlockStatus::done(FALSE_START);
        }
        int32_t reactionMs = (event.reactionUs + 500) / 1000;
        if(!this->recordMetric.empty()) {
            ctx.results.record(this->recordMetric.c_str(), this->resultPodId(ctx), reactionMs);
        }
        if(this->storeVar >= 0) {
            ctx.vars.set(this->storeVar, reactionMs);
        }
        return BlockStatus::done(NEXT);
    }

    if(!this->holdStarted) {
        if(this->holdTimeout > 0 && millis() - this->enterTime >= this->holdTimeout) {
            this->stopHold(ctx, false);
            return BlockStatus::done(NO_HOLD);
        }
        return BlockStatus::running();
    }

    // held: trigger counts maxHoldMs from the hold start, signal timeoutMs from the switch
    // (the central estimates the switch as hold start + goDelay)
    int64_t limitMs = this->signal ? (this->timeout > 0 ? (int64_t)this->goDelay + this->timeout : 0) : this->maxHold;
    if(limitMs > 0 && esp_timer_get_time() - this->holdStartUs >= limitMs * 1000) {
        this->stopHold(ctx, false);
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
