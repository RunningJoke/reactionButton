#include "RemotePressBlock.h"
#include "Block/JsonUtil.h"
#include "Link/IPodNetwork.h"

static const char* TAG = "REMOTEPRESS";

bool RemotePressBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pod.parse(json["pod"], ctx.vars) || !this->pod.isSet()) {
        return ctx.fail("missing 'pod'");
    }

    const char* mode = json["mode"] | "hit";
    if(strcmp(mode, "avoid") == 0) {
        this->avoid = true;
        this->colorActive = Protocol::Color::RED;
    } else if(strcmp(mode, "hit") != 0) {
        return ctx.fail("'mode' must be 'hit' or 'avoid'");
    }

    if(!json["color"].isNull() && !JsonUtil::parseRemoteColor(json["color"], this->colorActive)) {
        return ctx.fail("invalid 'color' (peripherals only support named colours)");
    }
    if(!json["colorAfter"].isNull() && !JsonUtil::parseRemoteColor(json["colorAfter"], this->colorAfter)) {
        return ctx.fail("invalid 'colorAfter' (peripherals only support named colours)");
    }
    if(!this->timeoutMs.parse(json["timeoutMs"], ctx.vars)) {
        return ctx.fail("invalid 'timeoutMs'");
    }

    if(!this->countdown.parse(json, ctx)) {
        return false;
    }
    if(this->countdown.active() && !this->timeoutMs.isSet()) {
        return ctx.fail("'countdown' needs 'timeoutMs'");
    }

    JsonUtil::getString(json["record"], this->recordMetric);
    const char* storeAs = json["storeAs"];
    if(storeAs != nullptr) {
        this->storeVar = ctx.vars.resolve(storeAs);
    }
    return true;
}

void RemotePressBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->podId = (uint8_t)this->pod.get(ctx.vars);
    this->armed = false;
    this->timeoutAtEnter = this->timeoutMs.isSet() ? this->timeoutMs.get(ctx.vars) : 0;

    if(ctx.network == nullptr || this->podId >= ctx.network->podCount()) {
        ESP_LOGE(TAG, "%s: pod %u not available", this->getName().c_str(), this->podId);
        return;
    }

    ArmCommand command;
    command.mode = this->avoid ? Protocol::PodMode::AVOID : Protocol::PodMode::HIT;
    command.colorActive = this->colorActive;
    command.colorAfter = this->colorAfter;
    // the pod counts down on its own ring; pods without effect support stay lit (secret)
    if(this->timeoutAtEnter > 0) {
        this->countdown.describe(this->colorActive, (uint32_t)this->timeoutAtEnter, command.waiting);
    }
    this->cmdSeq = ctx.network->arm(this->podId, command);
    this->armed = true;
}

BlockStatus RemotePressBlock::execute(BlockContext& ctx) {
    if(!this->armed) {
        return BlockStatus::done(TIMEOUT);
    }

    PodEvent event;
    while(ctx.network->pollEvent(event)) {
        if(event.kind != PodEvent::Kind::PRESSED || event.podId != this->podId || event.cmdSeq != this->cmdSeq) {
            ESP_LOGD(TAG, "ignoring event from pod %u", event.podId);
            continue;
        }

        ctx.network->reset(this->podId);
        if(!this->recordMetric.empty()) {
            ctx.results.record(this->recordMetric.c_str(), this->podId, event.reactionMs());
        }
        if(this->storeVar >= 0) {
            ctx.vars.set(this->storeVar, event.reactionMs());
        }
        return BlockStatus::done(NEXT);
    }

    // with a countdown the timeout is fixed on enter, the animation has a fixed length
    int64_t timeoutMs = this->countdown.active() ? this->timeoutAtEnter : this->timeoutMs.get(ctx.vars);
    if(this->timeoutMs.isSet() && millis() - this->enterTime >= (uint32_t)timeoutMs) {
        ctx.network->reset(this->podId);
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
