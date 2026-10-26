#include "EffectTarget.h"
#include "Link/IPodNetwork.h"

static const char* TAG = "EFFECTTARGET";

using Protocol::EffectDesc;
using Protocol::EffectId;

bool EffectTarget::parse(JsonVariantConst json, VariableManager& vars) {
    if(json.isNull()) {
        return true;
    }
    const char* name = json.is<const char*>() ? json.as<const char*>() : nullptr;
    if(name != nullptr && strcmp(name, "central") == 0) {
        this->mode = Mode::CENTRAL;
    } else if(name != nullptr && strcmp(name, "all") == 0) {
        this->mode = Mode::ALL;
    } else if(name != nullptr && strcmp(name, "peripherals") == 0) {
        this->mode = Mode::PERIPHERALS;
    } else {
        this->mode = Mode::POD;
        return this->pod.parse(json, vars) && this->pod.isSet();
    }
    return true;
}

int64_t EffectTarget::nowUs(BlockContext& ctx) {
    return ctx.network != nullptr ? ctx.network->nowUs() : esp_timer_get_time();
}

bool EffectTarget::includesCentral(BlockContext& ctx) const {
    return this->mode == Mode::CENTRAL || this->mode == Mode::ALL
        || (this->mode == Mode::POD && this->pod.get(ctx.vars) == ctx.centralPodId);
}

void EffectTarget::play(BlockContext& ctx, const EffectDesc& effect, int64_t startAtUs,
                        uint32_t ledMask, bool staticFallback) const {
    if(this->includesCentral(ctx)) {
        ctx.leds.playEffect(effect, startAtUs, ledMask);     // network time = local time on the central
    }
    if(ctx.network == nullptr || this->mode == Mode::CENTRAL) {
        return;
    }

    uint8_t first = 0;
    uint8_t last = ctx.network->podCount();     // exclusive
    if(this->mode == Mode::POD) {
        int64_t id = this->pod.get(ctx.vars);
        if(id == ctx.centralPodId) {
            return;
        }
        if(id < 0 || id >= ctx.network->podCount()) {
            ESP_LOGW(TAG, "pod %d not available", (int)id);
            return;
        }
        first = (uint8_t)id;
        last = first + 1;
    }

    for(uint8_t i = first; i < last; i++) {
        if(ctx.network->effect(i, effect, startAtUs)) {
            continue;
        }
        // no effect support: static colour (or off)
        if(effect.effect == EffectId::NONE || effect.color == Protocol::Color::OFF) {
            ctx.network->reset(i);
        } else if(staticFallback) {
            ArmCommand command;
            command.colorActive = effect.color;
            command.startAtUs = startAtUs;
            ctx.network->arm(i, command);
        }
    }
}
