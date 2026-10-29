#include "RemoteMultiplePressBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"
#include "Link/IPodNetwork.h"

static const char* TAG = "MULTIPRESS";

const char* RemoteMultiplePressBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "avoidHit", "timeout"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool RemoteMultiplePressBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pods.parse(json["pods"], ctx.vars) || !this->avoid.parse(json["avoid"], ctx.vars)
        || !this->timeoutMs.parse(json["timeoutMs"], ctx.vars) || !this->syncStartMs.parse(json["syncStartMs"], ctx.vars)) {
        return ctx.fail("invalid 'pods', 'avoid', 'syncStartMs' or 'timeoutMs'");
    }
    this->includeCentral = json["includeCentral"] | true;

    if(!json["hitColor"].isNull()) {
        if(!JsonUtil::parseRemoteColor(json["hitColor"], this->remoteHitColor)
            || !JsonUtil::parseColor(json["hitColor"], this->localHitColor)) {
            return ctx.fail("invalid 'hitColor' (named colours only)");
        }
    }
    if(!json["avoidColor"].isNull()) {
        if(!JsonUtil::parseRemoteColor(json["avoidColor"], this->remoteAvoidColor)
            || !JsonUtil::parseColor(json["avoidColor"], this->localAvoidColor)) {
            return ctx.fail("invalid 'avoidColor' (named colours only)");
        }
    }

    if(!this->countdown.parse(json, ctx)) {
        return false;
    }
    if(this->countdown.active() && !this->timeoutMs.isSet()) {
        return ctx.fail("'countdown' needs 'timeoutMs'");
    }

    JsonUtil::getString(json["record"], this->recordMetric);
    return true;
}

void RemoteMultiplePressBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->avoidMask = 0;
    this->remainingMask = 0;
    this->centralLit = false;
    this->timeoutAtEnter = this->timeoutMs.isSet() ? this->timeoutMs.get(ctx.vars) : 0;
    this->centralCountdown.effect = Protocol::EffectId::NONE;

    uint8_t connected = ctx.network != nullptr ? ctx.network->podCount() : 0;
    int64_t wanted = this->pods.isSet() ? this->pods.get(ctx.vars) : connected;
    this->podCount = (uint8_t)constrain(wanted, (int64_t)0, (int64_t)(connected < MAX_PODS ? connected : (uint8_t)MAX_PODS));

    // pod ids 0..podCount-1 are peripherals, podCount is the central
    uint8_t total = this->podCount + (this->includeCentral ? 1 : 0);
    if(total == 0) {
        return;
    }
    int64_t avoidCount = constrain(this->avoid.get(ctx.vars), (int64_t)0, (int64_t)(total - 1));

    for(int64_t picked = 0; picked < avoidCount; ) {
        uint32_t bit = 1UL << RandomUtil::below(total);
        if((this->avoidMask & bit) == 0) {
            this->avoidMask |= bit;
            picked++;
        }
    }

    // all pods (and the central) light up at the same network time
    int64_t lead = this->syncStartMs.get(ctx.vars);
    this->startAtUs = (ctx.network != nullptr ? ctx.network->nowUs() : esp_timer_get_time()) + lead * 1000;

    // countdown: the pods and the central light together and run out together at entry + timeout
    // (they start `lead` after the entry, so the animation is that much shorter)
    int64_t countdownMs = this->timeoutAtEnter - (lead > 0 ? lead : 0);
    bool counting = this->countdown.active() && countdownMs > 0;

    for(uint8_t i = 0; i < this->podCount; i++) {
        ArmCommand command;
        command.startAtUs = lead > 0 ? this->startAtUs : 0;
        if(this->avoidMask & (1UL << i)) {
            command.mode = Protocol::PodMode::AVOID;
            command.colorActive = this->remoteAvoidColor;
        } else {
            command.mode = Protocol::PodMode::HIT;
            command.colorActive = this->remoteHitColor;
            this->remainingMask |= 1UL << i;
        }
        if(counting) {
            this->countdown.describe(command.colorActive, (uint32_t)countdownMs, command.waiting);
        }
        this->cmdSeqs[i] = ctx.network->arm(i, command);
    }

    if(this->includeCentral && (this->avoidMask & (1UL << this->podCount)) == 0) {
        this->remainingMask |= 1UL << this->podCount;
    }
    if(counting && this->includeCentral) {
        bool centralAvoid = (this->avoidMask & (1UL << this->podCount)) != 0;
        this->countdown.describe(centralAvoid ? this->remoteAvoidColor : this->remoteHitColor,
                                 (uint32_t)countdownMs, this->centralCountdown);
    }

    if(this->includeCentral) {
        // the central lights up like the pods: armed here, drawn at startAtUs by a timer (LEDManager),
        // not by a loop pass that may come up to one loop gap late
        bool centralAvoid = (this->avoidMask & (1UL << this->podCount)) != 0;
        Protocol::EffectDesc light = {Protocol::EffectId::SOLID, centralAvoid ? this->remoteAvoidColor : this->remoteHitColor,
                                      Protocol::Color::OFF, 255, 0, 0, 0, 0};
        if(this->centralCountdown.effect != Protocol::EffectId::NONE) {
            light = this->centralCountdown;
        }
        ctx.leds.playEffect(light, this->startAtUs);
    }
}

BlockStatus RemoteMultiplePressBlock::execute(BlockContext& ctx) {
    uint32_t centralBit = 1UL << this->podCount;

    if(this->includeCentral && !this->centralLit && esp_timer_get_time() >= this->startAtUs) {
        // the light went on at startAtUs (see enter); here only the start is marked
        this->centralLit = true;
        this->centralLitUs = this->startAtUs;
        this->pressCountAtLight = ctx.button.pressCount();
    }

    PodEvent event;
    while(ctx.network != nullptr && ctx.network->pollEvent(event)) {
        if(event.kind != PodEvent::Kind::PRESSED || event.podId >= this->podCount || event.cmdSeq != this->cmdSeqs[event.podId]) {
            continue;   // not part of this round
        }
        uint32_t bit = 1UL << event.podId;

        if(event.result == Protocol::PressResult::AVOID_HIT || (this->avoidMask & bit)) {
            ESP_LOGI(TAG, "avoid pod %u was pressed", event.podId);
            ctx.network->reset(event.podId);
            return BlockStatus::done(AVOID_HIT);
        }
        if(this->remainingMask & bit) {
            this->remainingMask &= ~bit;
            ctx.network->reset(event.podId);
            if(!this->recordMetric.empty()) {
                ctx.results.record(this->recordMetric.c_str(), event.podId, event.reactionMs());
            }
        }
    }

    if(this->centralLit && ctx.button.pressCount() != this->pressCountAtLight) {
        // count each central press only once
        this->pressCountAtLight = ctx.button.pressCount();

        if(this->avoidMask & centralBit) {
            return BlockStatus::done(AVOID_HIT);
        }
        if(this->remainingMask & centralBit) {
            this->remainingMask &= ~centralBit;
            ctx.leds.turnOff();
            if(!this->recordMetric.empty()) {
                int32_t reactionMs = (int32_t)((ctx.button.lastPressTimeUs() - this->centralLitUs + 500) / 1000);
                ctx.results.record(this->recordMetric.c_str(), ctx.centralPodId, reactionMs);
            }
        }
    }

    if(this->remainingMask == 0) {
        return BlockStatus::done(NEXT);
    }
    // with a countdown the timeout is fixed on enter, the animation has a fixed length
    int64_t timeoutMs = this->countdown.active() ? this->timeoutAtEnter : this->timeoutMs.get(ctx.vars);
    if(this->timeoutMs.isSet() && millis() - this->enterTime >= (uint32_t)timeoutMs) {
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
