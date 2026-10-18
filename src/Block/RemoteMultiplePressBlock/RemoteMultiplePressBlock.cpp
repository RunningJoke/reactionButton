#include "RemoteMultiplePressBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"
#include "BLEManager/IBuzzerMode.h"
#include "Peripheral/Peripheral.h"

static const char* TAG = "MULTIPRESS";

const char* RemoteMultiplePressBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "avoidHit", "timeout"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool RemoteMultiplePressBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pods.parse(json["pods"], ctx.vars) || !this->avoid.parse(json["avoid"], ctx.vars)
        || !this->timeoutMs.parse(json["timeoutMs"], ctx.vars)) {
        return ctx.fail("invalid 'pods', 'avoid' or 'timeoutMs'");
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

    JsonUtil::getString(json["record"], this->recordMetric);
    return true;
}

void RemoteMultiplePressBlock::enter(BlockContext& ctx) {
    this->enterTime = millis();
    this->pressCountAtEnter = ctx.button.pressCount();
    this->avoidMask = 0;
    this->remainingMask = 0;

    uint8_t connected = ctx.remote != nullptr ? ctx.remote->getPeripheralCount() : 0;
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

    for(uint8_t i = 0; i < this->podCount; i++) {
        Peripheral* peripheral = ctx.remote->getPeripheral(i);
        if(peripheral == nullptr) {
            continue;
        }
        if(this->avoidMask & (1UL << i)) {
            peripheral->arm(PeripheralActionMode::AVOID, this->remoteAvoidColor, RemoteColor::OFF);
        } else {
            peripheral->arm(PeripheralActionMode::HIT, this->remoteHitColor, RemoteColor::OFF);
            this->remainingMask |= 1UL << i;
        }
    }

    if(this->includeCentral) {
        uint32_t centralBit = 1UL << this->podCount;
        if(this->avoidMask & centralBit) {
            ctx.leds.setLEDColors(&this->localAvoidColor);
        } else {
            ctx.leds.setLEDColors(&this->localHitColor);
            this->remainingMask |= centralBit;
        }
    }
}

BlockStatus RemoteMultiplePressBlock::execute(BlockContext& ctx) {
    PodEvent event;
    while(ctx.remote != nullptr && ctx.remote->pollEvent(event)) {
        if(event.podId >= this->podCount) {
            continue;
        }
        uint32_t bit = 1UL << event.podId;
        Peripheral* peripheral = ctx.remote->getPeripheral(event.podId);

        if(this->avoidMask & bit) {
            ESP_LOGI(TAG, "avoid pod %u was pressed", event.podId);
            if(peripheral != nullptr) peripheral->resetPeripheral();
            return BlockStatus::done(AVOID_HIT);
        }
        if(this->remainingMask & bit) {
            this->remainingMask &= ~bit;
            if(peripheral != nullptr) peripheral->resetPeripheral();
            if(!this->recordMetric.empty() && event.value >= 0) {
                ctx.results.record(this->recordMetric.c_str(), event.podId, event.value);
            }
        }
    }

    if(this->includeCentral && ctx.button.pressCount() != this->pressCountAtEnter) {
        // count each central press only once
        this->pressCountAtEnter = ctx.button.pressCount();
        uint32_t centralBit = 1UL << this->podCount;

        if(this->avoidMask & centralBit) {
            return BlockStatus::done(AVOID_HIT);
        }
        if(this->remainingMask & centralBit) {
            this->remainingMask &= ~centralBit;
            ctx.leds.turnOff();
            if(!this->recordMetric.empty()) {
                ctx.results.record(this->recordMetric.c_str(), ctx.centralPodId,
                                   (int32_t)(ctx.button.lastPressTime() - this->enterTime));
            }
        }
    }

    if(this->remainingMask == 0) {
        return BlockStatus::done(NEXT);
    }
    if(this->timeoutMs.isSet() && millis() - this->enterTime >= (uint32_t)this->timeoutMs.get(ctx.vars)) {
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
