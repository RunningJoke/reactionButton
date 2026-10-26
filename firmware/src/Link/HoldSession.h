#pragma once

#include <Arduino.h>
#include "Link/IPodNetwork.h"
#include "Link/Protocol.h"
#include "LEDManager/LEDManager.h"
#include "Input/Button.h"

/**
 * One CHARGE / RELEASE activation of a button: measures the hold, shows it on the ring and
 * reports what happened. The peripheral runs it for an ARM frame (PeripheralRole), the
 * central runs the same code for its own button (charge / release block with pod "central"),
 * so both behave alike. programs.md §7.13 / §7.14 and link-protocol.md §2.2 describe it.
 *
 * It owns the ring while it runs. All times are local esp_timer times (µs); the
 * measurements come from the button edge timestamps, not from the moment poll() runs.
 *
 *   begin(command)   shows the idle ring (waiting effect or colorActive) and starts
 *   poll(...)        call until it returns false, once per loop pass; returns the next event
 *   end()            forgets the activation (the caller changes the LEDs)
 *
 * Only a press edge after begin() starts a hold. RELEASE with HOLD_FLAG_ALLOW_HELD also takes
 * a button that is already down: that hold starts at begin().
 *
 *   CHARGE   (accumulate off) a hold of at least onsetMs charges for up to maxMs; the charge
 *            effect is shown. Release ends: RELEASED{charge, EARLY if before the onset}.
 *            Reaching the maximum ends at once: ring flash, RELEASED{FULL}.
 *   CHARGE   (accumulate) the charge is kept (decayMs 0) or drains while released; further
 *            holds go on from the current charge. Ends with FULL or, at limitMs, with
 *            RELEASED{LIMIT, charge}.
 *   RELEASE  trigger: the release ends, RELEASED{held}. signal: goDelayMs after the hold
 *            start the ring switches (goColor / effect); a release before it is a false
 *            start, after it RELEASED{reaction = release - switch}.
 */
class HoldSession {
    public:
        struct Event {
            enum class Kind : uint8_t { HOLD_STARTED, RELEASED };
            Kind kind = Kind::HOLD_STARTED;
            uint8_t flags = 0;          // Protocol::RELEASED_FLAG_*
            int32_t reactionUs = 0;     // HOLD_STARTED: activation -> press. RELEASED: switch -> release
            uint32_t heldMs = 0;
            uint32_t chargeMs = 0;
        };

        // Shows the idle ring and starts. command.mode must be CHARGE or RELEASE.
        void begin(const ArmCommand& command, Button& button, LEDManager& leds);

        // Next event, false if there is none (yet)
        bool poll(int64_t nowUs, Event& out);

        void end() { this->state = State::OFF; }

        // True from begin() until the final RELEASED event (or end())
        bool running() const { return this->state == State::IDLE || this->state == State::HELD; }

    private:
        enum class State : uint8_t { OFF, IDLE, HELD, DONE };

        static const int64_t DECAY_FRAME_US = 33000;        // ring update rate while a charge drains
        static const uint16_t FLASH_PERIOD_MS = 200;
        static const uint32_t FLASH_MS = 600;

        void startHold(int64_t atUs, bool alreadyDown);
        void showCharge(int64_t nowUs, int64_t chargeUs);
        void doSwitch();
        int64_t chargeAt(int64_t atUs) const;
        void finish(Event& out, uint8_t flags, int64_t heldUs, int64_t chargeUs, int32_t reactionUs);
        bool pollHeld(int64_t nowUs, Event& out);

        ArmCommand command;
        Button* button = nullptr;
        LEDManager* leds = nullptr;
        State state = State::OFF;

        bool charge = false;
        bool accumulate = false;
        bool signal = false;
        int64_t onsetUs = 0;
        int64_t maxUs = 0;
        int64_t decayUs = 0;

        int64_t activatedUs = 0;
        uint32_t seenPresses = 0;
        bool startPending = false;          // HOLD_STARTED not yet delivered
        int32_t startReactionUs = 0;

        // current hold
        int64_t holdStartUs = 0;
        bool chargeRunning = false;         // the charge effect plays (onset is over)
        int64_t goAtUs = 0;                 // signal: nominal switch time
        int64_t switchUs = 0;               // signal: when the ring switched
        bool switched = false;

        // charge
        int64_t baseUs = 0;                 // charge at the start of the current hold / the last release
        int64_t releasedAtUs = 0;
        int64_t heldTotalUs = 0;            // earlier holds (accumulate)
        int64_t lastDecayDrawUs = 0;
        bool decayDrawn = false;
};
