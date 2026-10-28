#pragma once

#include <Arduino.h>
#include "Link/Protocol.h"

/**
 * A press or release reported by a peripheral.
 */
struct PodEvent {
    enum class Kind : uint8_t {
        PRESSED,        // button pressed (for CHARGE / RELEASE activations: a hold started)
        RELEASED,       // end of a hold (RELEASED frame, only for CHARGE / RELEASE activations)
    };

    uint8_t podId;
    uint8_t cmdSeq;                     // activation the press belongs to (see IPodNetwork::arm)
    Protocol::PressResult result;
    int32_t reactionUs;                 // measured on the peripheral: LED on -> press (RELEASED: switch -> release)
    int64_t rxTimeUs;                   // central clock when the event arrived
    Kind kind = Kind::PRESSED;
    uint8_t flags = 0;                  // RELEASED: Protocol::RELEASED_FLAG_*
    uint32_t heldMs = 0;                // RELEASED: hold time measured on the peripheral
    uint32_t chargeMs = 0;              // RELEASED: charge at the end
    uint8_t owner = Protocol::OWNER_NONE;   // PRESSED of a TOGGLE activation: owner after the press (absolute)
    uint16_t flipCount = 0;             // PRESSED of a TOGGLE activation: flips since the ARM; 0 = no toggle data

    int32_t reactionMs() const { return (this->reactionUs + 500) / 1000; }
};

struct ArmCommand {
    Protocol::PodMode mode = Protocol::PodMode::HIT;
    uint8_t colorActive = Protocol::Color::GREEN;
    uint8_t colorAfter = Protocol::Color::OFF;
    int64_t startAtUs = 0;              // network time (see nowUs), 0 = immediately

    // Optional effect while waiting for the press, started at the activation (startAtUs).
    // Pods without effect support (supportsEffects false) show colorActive instead.
    Protocol::EffectDesc waiting = {Protocol::EffectId::NONE, Protocol::Color::GREEN, Protocol::Color::OFF,
                                    255, 0, 0, 0, 0};

    // PodMode CHARGE / RELEASE only (needs IPodNetwork::supportsHold)
    Protocol::HoldParams hold = {};

    // PodMode TOGGLE only (needs IPodNetwork::supportsToggle). colorActive is team A, colorAfter team B.
    Protocol::ToggleParams toggle = {};
};

/**
 * The peripherals of the set, as seen by the game logic on the central.
 * Peripherals have ids 0 .. podCount()-1.
 */
class IPodNetwork {
    public:
        virtual ~IPodNetwork() {}

        virtual uint8_t podCount() const = 0;
        virtual bool isAlive(uint8_t podId) const = 0;

        // Lights a pod. Returns the command sequence number that its PodEvent will carry.
        virtual uint8_t arm(uint8_t podId, const ArmCommand& command) = 0;

        // Switches a pod off and cancels a pending activation
        virtual void reset(uint8_t podId) = 0;

        // Next press event, false if none
        virtual bool pollEvent(PodEvent& event) = 0;

        // Time base shared with all peripherals (µs). Use it for ArmCommand::startAtUs.
        virtual int64_t nowUs() const = 0;

        // Whether the pod plays effects (EFFECT frames, ArmCommand::waiting). False for
        // pods with older firmware: show a static colour (arm / colorActive) instead.
        virtual bool supportsEffects(uint8_t podId) const { return false; }

        // Whether the pod measures holds (PodMode CHARGE / RELEASE, RELEASED frames). False for pods
        // with an older link protocol: the hold blocks take their timeout port at once.
        virtual bool supportsHold(uint8_t podId) const { return false; }

        // Whether the pod flips colours on every press (PodMode TOGGLE, PRESSED owner / flipCount). False for
        // pods with an older link protocol: the toggle block leaves them out of the game.
        virtual bool supportsToggle(uint8_t podId) const { return false; }

        // Plays an effect on a pod's ring, starting at startAtUs (network time, 0 = now).
        // Does not arm or reset the pod. EffectId::NONE stops it and switches the LEDs off.
        // Returns false (nothing sent) if the pod does not support effects.
        virtual bool effect(uint8_t podId, const Protocol::EffectDesc& effect, int64_t startAtUs) { return false; }
};
