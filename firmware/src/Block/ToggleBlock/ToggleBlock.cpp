#include "ToggleBlock.h"
#include "Block/JsonUtil.h"
#include "Block/RandomUtil.h"
#include "Link/IPodNetwork.h"

using namespace Protocol;

static const char* TAG = "TOGGLE";

const char* ToggleBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "allA", "allB"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool ToggleBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pods.parse(json["pods"], ctx.vars) || !this->cooldownMs.parse(json["cooldownMs"], ctx.vars)
        || !this->syncStartMs.parse(json["syncStartMs"], ctx.vars)) {
        return ctx.fail("invalid 'pods', 'cooldownMs' or 'syncStartMs'");
    }
    this->includeCentral = json["includeCentral"] | true;

    if(!json["colors"].isNull()) {
        JsonArrayConst colors = json["colors"];
        if(colors.size() != 2 || !JsonUtil::parseRemoteColor(colors[0], this->colorA)
            || !JsonUtil::parseRemoteColor(colors[1], this->colorB)) {
            return ctx.fail("'colors' must be two named colours");
        }
    }

    if(!json["start"].isNull()) {
        const char* start = json["start"].as<const char*>();
        if(start == nullptr) return ctx.fail("invalid 'start'");
        if(strcmp(start, "a") == 0) this->start = Start::A;
        else if(strcmp(start, "b") == 0) this->start = Start::B;
        else if(strcmp(start, "alternate") == 0) this->start = Start::ALTERNATE;
        else if(strcmp(start, "random") == 0) this->start = Start::RANDOM;
        else if(strcmp(start, "off") == 0) this->start = Start::OFF;
        else return ctx.fail("'start' must be a, b, alternate, random or off");
    }

    if(!json["durationMs"].isNull()) {
        if(!this->durationMs.parse(json["durationMs"], ctx.vars)) {
            return ctx.fail("invalid 'durationMs'");
        }
        this->minDurationMs = this->durationMs;
        this->maxDurationMs = this->durationMs;
    } else if(!this->minDurationMs.parse(json["minDurationMs"], ctx.vars)
            || !this->maxDurationMs.parse(json["maxDurationMs"], ctx.vars)
            || !this->minDurationMs.isSet() || !this->maxDurationMs.isSet()) {
        return ctx.fail("needs 'durationMs' or 'minDurationMs' + 'maxDurationMs'");
    }
    if(!this->countdown.parse(json, ctx)) {
        return false;
    }

    const char* names[5] = {json["storeA"], json["storeB"], json["storeTimeA"], json["storeTimeB"], json["storeFlips"]};
    VarId* vars[5] = {&this->storeA, &this->storeB, &this->storeTimeA, &this->storeTimeB, &this->storeFlips};
    for(int i = 0; i < 5; i++) {
        if(names[i] != nullptr) {
            *vars[i] = ctx.vars.resolve(names[i]);
        }
    }
    return true;
}

uint8_t ToggleBlock::colorOf(uint8_t owner) const {
    return owner == OWNER_A ? this->colorA : owner == OWNER_B ? this->colorB : (uint8_t)Color::OFF;
}

void ToggleBlock::enter(BlockContext& ctx) {
    this->centralLit = false;
    this->participants = 0;
    this->teamUs[0] = this->teamUs[1] = 0;
    this->centralCountdown.effect = EffectId::NONE;

    uint8_t connected = ctx.network != nullptr ? ctx.network->podCount() : 0;
    int64_t wanted = this->pods.isSet() ? this->pods.get(ctx.vars) : connected;
    this->podCount = (uint8_t)constrain(wanted, (int64_t)0, (int64_t)(connected < MAX_PODS ? connected : (uint8_t)MAX_PODS));

    int64_t duration = RandomUtil::between(this->minDurationMs.get(ctx.vars), this->maxDurationMs.get(ctx.vars));
    int64_t cooldown = this->cooldownMs.get(ctx.vars);
    this->cooldownMsAtEnter = (uint32_t)constrain(cooldown, (int64_t)0, (int64_t)UINT16_MAX);

    int64_t lead = this->syncStartMs.get(ctx.vars);
    if(lead < 0) {
        lead = 0;
    }
    this->startAtUs = (ctx.network != nullptr ? ctx.network->nowUs() : esp_timer_get_time()) + lead * 1000;
    this->endAtUs = this->startAtUs + (duration > 0 ? duration : 0) * 1000;

    bool counting = this->countdown.active() && duration > 0;
    uint8_t ordinal = 0;

    for(uint8_t i = 0; i <= this->podCount; i++) {
        bool central = i == this->podCount;
        if(central ? !this->includeCentral : !ctx.network->supportsToggle(i)) {
            if(!central) {
                ESP_LOGW(TAG, "pod %u cannot toggle (older firmware), left out", i);
            }
            continue;
        }

        uint8_t startOwner = OWNER_NONE;
        switch(this->start) {
            case Start::A: startOwner = OWNER_A; break;
            case Start::B: startOwner = OWNER_B; break;
            case Start::ALTERNATE: startOwner = (ordinal & 1) ? OWNER_B : OWNER_A; break;
            case Start::RANDOM: startOwner = RandomUtil::below(2) == 0 ? OWNER_A : OWNER_B; break;
            case Start::OFF: break;
        }
        this->owner[i] = startOwner;
        this->flips[i] = 0;
        this->changedUs[i] = this->startAtUs;

        EffectDesc waiting = {EffectId::NONE, 0, Color::OFF, 255, 0, 0, 0, 0};
        if(counting) {
            this->countdown.describe(this->colorOf(startOwner), (uint32_t)duration, waiting);
        }

        if(central) {
            this->participants |= 1UL << i;
            this->centralCountdown = waiting;
            ordinal++;
            continue;
        }

        ArmCommand command;
        command.mode = PodMode::TOGGLE;
        command.colorActive = this->colorA;
        command.colorAfter = this->colorB;
        command.startAtUs = lead > 0 ? this->startAtUs : 0;
        command.waiting = waiting;
        command.toggle.startOwner = startOwner;
        command.toggle.cooldownMs = (uint16_t)this->cooldownMsAtEnter;
        this->cmdSeqs[i] = ctx.network->arm(i, command);
        this->participants |= 1UL << i;
        ordinal++;
    }

    if(this->participants & (1UL << this->podCount)) {
        this->armCentral(ctx);
    }
}

// The central lights up at startAtUs like the pods: LEDManager draws it from a timer
void ToggleBlock::armCentral(BlockContext& ctx) {
    uint8_t color = this->colorOf(this->owner[this->podCount]);
    EffectDesc effect = {EffectId::SOLID, color, Color::OFF, 255, 0, 0, 0, 0};
    if(this->centralCountdown.effect != EffectId::NONE) {
        effect = this->centralCountdown;
        effect.color = color;
    }
    ctx.leds.playEffect(effect, this->startAtUs);   // same start time as the pods
}

void ToggleBlock::showCentral(BlockContext& ctx) {
    uint8_t color = this->colorOf(this->owner[this->podCount]);
    if(this->centralCountdown.effect != EffectId::NONE) {
        EffectDesc effect = this->centralCountdown;
        effect.color = color;
        ctx.leds.playEffect(effect, this->startAtUs);   // same start time as the pods, so a flip joins the animation
    } else {
        ctx.leds.setLEDColors(color);
    }
}

// Owner of an index changes at atUs: the time up to now goes to the old owner
void ToggleBlock::flip(uint8_t index, uint8_t owner, int64_t atUs) {
    if(atUs < this->changedUs[index]) {
        atUs = this->changedUs[index];
    }
    if(this->owner[index] != OWNER_NONE) {
        this->teamUs[this->owner[index]] += atUs - this->changedUs[index];
    }
    this->changedUs[index] = atUs;
    this->owner[index] = owner;
}

bool ToggleBlock::allSame(uint8_t owner) const {
    if(this->participants == 0) {
        return false;
    }
    for(uint8_t i = 0; i <= this->podCount; i++) {
        if((this->participants & (1UL << i)) && this->owner[i] != owner) {
            return false;
        }
    }
    return true;
}

BlockStatus ToggleBlock::execute(BlockContext& ctx) {
    uint8_t centralIndex = this->podCount;
    uint32_t centralBit = 1UL << centralIndex;
    bool flipped = false;
    int64_t now = esp_timer_get_time();

    if((this->participants & centralBit) && !this->centralLit && now >= this->startAtUs) {
        // lit at startAtUs by the timer armed in enter(); here only the start is marked
        this->centralLit = true;
        this->pressCountAtLight = ctx.button.pressCount();
    }

    PodEvent event;
    while(ctx.network != nullptr && ctx.network->pollEvent(event)) {
        if(event.kind != PodEvent::Kind::PRESSED || event.podId >= this->podCount || event.flipCount == 0
            || !(this->participants & (1UL << event.podId)) || event.cmdSeq != this->cmdSeqs[event.podId]
            || event.owner > OWNER_B || event.rxTimeUs > this->endAtUs) {
            continue;   // not part of this game
        }
        // flipCount counts up: a duplicate or an older frame is dropped, a skipped one (lost frame) still counts
        if((int16_t)(event.flipCount - this->flips[event.podId]) <= 0) {
            continue;
        }
        this->flips[event.podId] = event.flipCount;
        if(this->owner[event.podId] != event.owner) {
            this->flip(event.podId, event.owner, event.rxTimeUs);
            flipped = true;
        }
    }

    if(this->centralLit && ctx.button.pressCount() != this->pressCountAtLight) {
        this->pressCountAtLight = ctx.button.pressCount();     // several presses in one pass count once
        int64_t pressUs = ctx.button.lastPressTimeUs();
        bool allowed = this->flips[centralIndex] == 0
            || pressUs - this->centralLastFlipUs >= (int64_t)this->cooldownMsAtEnter * 1000;
        if(allowed && pressUs <= this->endAtUs) {
            this->centralLastFlipUs = pressUs;
            this->flips[centralIndex]++;
            this->flip(centralIndex, this->owner[centralIndex] == OWNER_A ? OWNER_B : OWNER_A, pressUs);
            this->showCentral(ctx);
            flipped = true;
        }
    }

    if(flipped) {
        if(this->isConnected(ALL_A) && this->allSame(OWNER_A)) {
            return this->finish(ctx, now, ALL_A);
        }
        if(this->isConnected(ALL_B) && this->allSame(OWNER_B)) {
            return this->finish(ctx, now, ALL_B);
        }
    }

    if(now >= this->endAtUs) {
        return this->finish(ctx, this->endAtUs, NEXT);
    }
    return BlockStatus::running();
}

// Settles the owned time, stores the results and freezes the pods in their colours
BlockStatus ToggleBlock::finish(BlockContext& ctx, int64_t atUs, uint8_t port) {
    int64_t teamPods[2] = {0, 0};
    uint32_t totalFlips = 0;

    for(uint8_t i = 0; i <= this->podCount; i++) {
        if(!(this->participants & (1UL << i))) {
            continue;
        }
        this->flip(i, this->owner[i], atUs);        // adds the time up to atUs to the owner
        totalFlips += this->flips[i];
        if(this->owner[i] != OWNER_NONE) {
            teamPods[this->owner[i]]++;
        }

        // the ring keeps the colour, a press no longer changes it (plain activation, same colour before and after)
        uint8_t color = this->colorOf(this->owner[i]);
        if(i == this->podCount) {
            ctx.leds.setLEDColors(color);
        } else {
            ArmCommand command;
            command.mode = PodMode::HIT;
            command.colorActive = color;
            command.colorAfter = color;
            ctx.network->arm(i, command);
        }
    }

    VarId ids[5] = {this->storeA, this->storeB, this->storeTimeA, this->storeTimeB, this->storeFlips};
    int64_t values[5] = {teamPods[0], teamPods[1], (this->teamUs[0] + 500) / 1000, (this->teamUs[1] + 500) / 1000, totalFlips};
    for(int i = 0; i < 5; i++) {
        if(ids[i] >= 0) {
            ctx.vars.set(ids[i], values[i]);
        }
    }
    return BlockStatus::done(port);
}
