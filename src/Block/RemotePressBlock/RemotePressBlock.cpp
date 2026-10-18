#include "RemotePressBlock.h"
#include "Block/JsonUtil.h"
#include "BLEManager/IBuzzerMode.h"
#include "Peripheral/Peripheral.h"

static const char* TAG = "REMOTEPRESS";

bool RemotePressBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pod.parse(json["pod"], ctx.vars) || !this->pod.isSet()) {
        return ctx.fail("missing 'pod'");
    }

    const char* mode = json["mode"] | "hit";
    if(strcmp(mode, "avoid") == 0) {
        this->avoid = true;
        this->colorActive = RemoteColor::RED;
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
    this->peripheral = nullptr;

    if(ctx.remote != nullptr && this->podId < ctx.remote->getPeripheralCount()) {
        this->peripheral = ctx.remote->getPeripheral(this->podId);
    }
    if(this->peripheral == nullptr) {
        ESP_LOGE(TAG, "%s: pod %u not available", this->getName().c_str(), this->podId);
        return;
    }

    this->peripheral->arm(this->avoid ? PeripheralActionMode::AVOID : PeripheralActionMode::HIT,
                          this->colorActive, this->colorAfter);
}

BlockStatus RemotePressBlock::execute(BlockContext& ctx) {
    if(this->peripheral == nullptr) {
        return BlockStatus::done(TIMEOUT);
    }

    PodEvent event;
    while(ctx.remote->pollEvent(event)) {
        if(event.podId != this->podId) {
            ESP_LOGW(TAG, "ignoring event from pod %u", event.podId);
            continue;
        }

        this->peripheral->resetPeripheral();
        if(event.value >= 0) {
            if(!this->recordMetric.empty()) {
                ctx.results.record(this->recordMetric.c_str(), this->podId, event.value);
            }
            if(this->storeVar >= 0) {
                ctx.vars.set(this->storeVar, event.value);
            }
        }
        return BlockStatus::done(NEXT);
    }

    if(this->timeoutMs.isSet() && millis() - this->enterTime >= (uint32_t)this->timeoutMs.get(ctx.vars)) {
        this->peripheral->resetPeripheral();
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
