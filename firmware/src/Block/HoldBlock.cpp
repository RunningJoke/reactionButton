#include "HoldBlock.h"

static const char* TAG = "HOLDBLOCK";

bool HoldBlock::parsePod(JsonVariantConst json, VariableManager& vars) {
    this->podCentral = true;
    if(json.isNull()) {
        return true;
    }
    const char* name = json.is<const char*>() ? json.as<const char*>() : nullptr;
    if(name != nullptr && strcmp(name, "central") == 0) {
        return true;
    }
    this->podCentral = false;
    return this->pod.parse(json, vars) && this->pod.isSet();
}

bool HoldBlock::startHold(BlockContext& ctx, const ArmCommand& command) {
    this->active = false;
    this->local = this->podCentral;
    if(!this->podCentral) {
        int64_t id = this->pod.get(ctx.vars);
        if(id == ctx.centralPodId) {
            this->local = true;
        } else if(ctx.network == nullptr || id < 0 || id >= ctx.network->podCount()) {
            ESP_LOGE(TAG, "%s: pod %d not available", this->getName().c_str(), (int)id);
            return false;
        } else {
            this->podId = (uint8_t)id;
        }
    }

    if(this->local) {
        this->session.begin(command, ctx.button, ctx.leds);
    } else {
        if(!ctx.network->supportsHold(this->podId)) {
            ESP_LOGW(TAG, "%s: pod %u cannot measure holds (older firmware)", this->getName().c_str(), this->podId);
            return false;
        }
        this->cmdSeq = ctx.network->arm(this->podId, command);
    }
    this->active = true;
    return true;
}

bool HoldBlock::pollHold(BlockContext& ctx, HoldEvent& event) {
    if(!this->active) {
        return false;
    }

    if(this->local) {
        HoldSession::Event e;
        int64_t now = esp_timer_get_time();
        if(!this->session.poll(now, e)) {
            return false;
        }
        event = HoldEvent();
        event.kind = e.kind == HoldSession::Event::Kind::HOLD_STARTED ? HoldEvent::Kind::HOLD_STARTED : HoldEvent::Kind::RELEASED;
        event.flags = e.flags;
        event.reactionUs = e.reactionUs;
        event.heldMs = e.heldMs;
        event.chargeMs = e.chargeMs;
        event.atUs = now;
        return true;
    }

    PodEvent e;
    while(ctx.network->pollEvent(e)) {
        if(e.podId != this->podId || e.cmdSeq != this->cmdSeq) {
            ESP_LOGD(TAG, "ignoring event from pod %u", e.podId);
            continue;
        }
        event = HoldEvent();
        event.kind = e.kind == PodEvent::Kind::PRESSED ? HoldEvent::Kind::HOLD_STARTED : HoldEvent::Kind::RELEASED;
        event.flags = e.flags;
        event.reactionUs = e.reactionUs;
        event.heldMs = e.heldMs;
        event.chargeMs = e.chargeMs;
        event.atUs = e.rxTimeUs;
        return true;
    }
    return false;
}

void HoldBlock::stopHold(BlockContext& ctx, bool keepRing) {
    if(!this->active) {
        return;
    }
    this->active = false;
    if(this->local) {
        this->session.end();
        if(!keepRing) {
            ctx.leds.turnOff();
        }
    } else if(!keepRing) {
        ctx.network->reset(this->podId);
    }
}

void HoldBlock::exit(BlockContext& ctx) {
    // left in another way (pause, program end): the session stops, the ring stays as it is
    if(this->active && this->local) {
        this->session.end();
    }
    this->active = false;
}
