#include "HoldSession.h"

using namespace Protocol;

static int64_t msToUs(uint32_t ms) { return (int64_t)ms * 1000; }

void HoldSession::begin(const ArmCommand& command, Button& button, LEDManager& leds) {
    this->command = command;
    this->button = &button;
    this->leds = &leds;

    const HoldParams& hold = command.hold;
    this->charge = command.mode == PodMode::CHARGE;
    this->accumulate = this->charge && (hold.flags & HOLD_FLAG_ACCUMULATE) != 0;
    this->signal = !this->charge && (hold.flags & HOLD_FLAG_SIGNAL) != 0;
    this->onsetUs = msToUs(hold.onsetMs);
    this->maxUs = msToUs(hold.maxMs > 0 ? hold.maxMs : 1);
    this->decayUs = msToUs(hold.decayMs);

    this->baseUs = 0;
    this->heldTotalUs = 0;
    this->releasedAtUs = 0;
    this->decayDrawn = true;        // nothing to drain yet
    this->startPending = false;
    this->switched = false;
    this->chargeRunning = false;

    // the idle ring: the waiting effect (e.g. a countdown), else the static colour
    if(command.waiting.effect == EffectId::NONE || !leds.playEffect(command.waiting, 0)) {
        leds.setLEDColors(command.colorActive);
    }
    // measure from the moment the LED data was sent; only presses after this start a hold
    this->activatedUs = esp_timer_get_time();
    this->seenPresses = button.pressCount();
    this->state = State::IDLE;

    if(!this->charge && (hold.flags & HOLD_FLAG_ALLOW_HELD) != 0 && button.isDown()) {
        this->startHold(this->activatedUs, true);
    }
}

// A hold starts at atUs (the press edge, or the activation for a button that is already down)
void HoldSession::startHold(int64_t atUs, bool alreadyDown) {
    const HoldParams& hold = this->command.hold;
    if(this->charge) {
        this->baseUs = this->chargeAt(atUs);        // a charge that drained meanwhile (state is still IDLE)
    }
    this->state = State::HELD;
    this->holdStartUs = atUs;
    this->startPending = true;
    this->startReactionUs = alreadyDown ? 0 : (int32_t)(atUs - this->activatedUs);

    if(this->charge) {
        this->chargeRunning = false;
        this->decayDrawn = true;
        // the ring shows the charge so far (it replaces a countdown); the charge effect goes on after the onset
        this->showCharge(esp_timer_get_time(), this->baseUs);
    } else {
        this->goAtUs = atUs + msToUs(hold.goDelayMs);
        this->switched = false;
        // trigger with a countdown over maxHoldMs, else the static "held" colour
        if(this->signal || hold.effect.effect == EffectId::NONE || !this->leds->playEffect(hold.effect, 0)) {
            this->leds->setLEDColors(hold.heldColor);
        }
    }
}

// Shows the charge effect frozen at chargeUs (the effect is a function of the time since its start)
void HoldSession::showCharge(int64_t nowUs, int64_t chargeUs) {
    if(this->command.hold.effect.effect == EffectId::NONE) {
        return;
    }
    this->leds->playEffect(this->command.hold.effect, nowUs - chargeUs);
    this->leds->stopEffect();
}

void HoldSession::doSwitch() {
    const HoldParams& hold = this->command.hold;
    if(hold.effect.effect == EffectId::NONE || !this->leds->playEffect(hold.effect, 0)) {
        this->leds->setLEDColors(hold.goColor);
    }
    this->switchUs = esp_timer_get_time();
    this->switched = true;
}

// Charge at atUs. During a hold it grows after the onset, while released it drains (decayMs).
int64_t HoldSession::chargeAt(int64_t atUs) const {
    int64_t value;
    if(this->state == State::HELD) {
        int64_t charging = (atUs - this->holdStartUs) - this->onsetUs;
        value = this->baseUs + (charging > 0 ? charging : 0);
    } else if(this->decayUs > 0 && this->baseUs > 0) {
        value = this->baseUs - (atUs - this->releasedAtUs) * this->maxUs / this->decayUs;
    } else {
        value = this->baseUs;
    }
    return value < 0 ? 0 : (value > this->maxUs ? this->maxUs : value);
}

void HoldSession::finish(Event& out, uint8_t flags, int64_t heldUs, int64_t chargeUs, int32_t reactionUs) {
    out.kind = Event::Kind::RELEASED;
    out.flags = flags;
    out.heldMs = (uint32_t)((heldUs + 500) / 1000);
    out.chargeMs = (uint32_t)((chargeUs + 500) / 1000);
    out.reactionUs = reactionUs;
    this->state = State::DONE;
}

bool HoldSession::poll(int64_t nowUs, Event& out) {
    if(this->state == State::OFF || this->state == State::DONE) {
        return false;
    }
    const HoldParams& hold = this->command.hold;

    if(this->startPending) {
        this->startPending = false;
        out = Event();
        out.kind = Event::Kind::HOLD_STARTED;
        out.reactionUs = this->startReactionUs;
        return true;
    }

    // time limit of an accumulating charge: report the charge as it is at the limit
    if(this->accumulate && hold.limitMs > 0 && nowUs - this->activatedUs >= msToUs(hold.limitMs)) {
        int64_t atLimit = this->activatedUs + msToUs(hold.limitMs);
        int64_t held = this->heldTotalUs + (this->state == State::HELD ? atLimit - this->holdStartUs : 0);
        this->finish(out, RELEASED_FLAG_LIMIT, held, this->chargeAt(atLimit), 0);
        this->leds->setLEDColors(this->command.colorAfter);
        return true;
    }

    if(this->state == State::IDLE) {
        if(this->button->pressCount() != this->seenPresses) {
            this->seenPresses = this->button->pressCount();
            this->startHold(this->button->lastPressTimeUs(), false);
            return this->poll(nowUs, out);      // delivers HOLD_STARTED
        }
        // a drained charge is drawn while it drops
        if(this->accumulate && !this->decayDrawn && nowUs - this->lastDecayDrawUs >= DECAY_FRAME_US) {
            int64_t value = this->chargeAt(nowUs);
            this->showCharge(nowUs, value);
            this->lastDecayDrawUs = nowUs;
            this->decayDrawn = value == 0;
        }
        return false;
    }

    return this->pollHeld(nowUs, out);
}

bool HoldSession::pollHeld(int64_t nowUs, Event& out) {
    const HoldParams& hold = this->command.hold;
    bool released = !this->button->isDown();
    int64_t releaseUs = this->button->lastReleaseTimeUs();
    if(releaseUs < this->holdStartUs) {
        releaseUs = this->holdStartUs;
    }
    int64_t heldUs = (released ? releaseUs : nowUs) - this->holdStartUs;

    if(!this->charge) {
        // ---- RELEASE
        if(this->signal && !this->switched) {
            if(released && releaseUs < this->goAtUs) {
                this->finish(out, RELEASED_FLAG_FALSE_START, heldUs, 0, 0);
                this->leds->setLEDColors(this->command.colorAfter);
                return true;
            }
            if(released) {
                // released right after the switch time, before this pass showed it: no need to show it
                this->switched = true;
                this->switchUs = this->goAtUs;
            } else if(nowUs >= this->goAtUs) {
                this->doSwitch();
            }
        }
        if(!released) {
            return false;
        }
        int32_t reactionUs = 0;
        if(this->signal) {
            int64_t reaction = releaseUs - this->switchUs;
            reactionUs = reaction > 0 ? (int32_t)reaction : 0;
        }
        this->finish(out, 0, heldUs, 0, reactionUs);
        this->leds->setLEDColors(this->command.colorAfter);
        return true;
    }

    // ---- CHARGE
    int64_t fullAtUs = this->holdStartUs + this->onsetUs + (this->maxUs - this->baseUs);
    if((released ? releaseUs : nowUs) >= fullAtUs) {
        int64_t held = this->heldTotalUs + (fullAtUs - this->holdStartUs);
        this->finish(out, RELEASED_FLAG_FULL, held, this->maxUs, 0);
        // flash in the colour of the charge (the end colour of a colour shift)
        const EffectDesc& charge = hold.effect;
        uint8_t color = charge.effect == EffectId::COLOR_SHIFT ? charge.color2 : charge.color;
        EffectDesc flash = {EffectId::BLINK, color, Color::OFF, 255, FLASH_MS, FLASH_PERIOD_MS, 0, EFFECT_FLAG_END_OFF};
        this->leds->playEffect(flash, 0);
        return true;
    }

    if(!released) {
        if(!this->chargeRunning && nowUs >= this->holdStartUs + this->onsetUs) {
            this->chargeRunning = true;
            if(hold.effect.effect != EffectId::NONE) {
                this->leds->playEffect(hold.effect, this->holdStartUs + this->onsetUs - this->baseUs);
            }
        }
        return false;
    }

    if(!this->accumulate) {
        int64_t charge = heldUs - this->onsetUs;
        this->finish(out, heldUs < this->onsetUs ? RELEASED_FLAG_EARLY : 0, heldUs, charge > 0 ? charge : 0, 0);
        this->leds->setLEDColors(this->command.colorAfter);
        return true;
    }

    // accumulate: the release pauses the charge (it is kept or drains), the hold session goes on
    this->baseUs = this->chargeAt(releaseUs);
    this->heldTotalUs += releaseUs - this->holdStartUs;
    this->releasedAtUs = releaseUs;
    this->state = State::IDLE;
    this->seenPresses = this->button->pressCount();
    this->showCharge(nowUs, this->chargeAt(nowUs));     // freezes the ring at the charge it has now
    this->decayDrawn = this->decayUs == 0 || this->baseUs == 0;
    this->lastDecayDrawUs = nowUs;
    return false;
}
