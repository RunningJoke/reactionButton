#pragma once

#include <Arduino.h>
#include "Link/Protocol.h"

/**
 * A press reported by a peripheral.
 */
struct PodEvent {
    uint8_t podId;
    uint8_t cmdSeq;                     // activation the press belongs to (see IPodNetwork::arm)
    Protocol::PressResult result;
    int32_t reactionUs;                 // measured on the peripheral: LED on -> press
    int64_t rxTimeUs;                   // central clock when the event arrived

    int32_t reactionMs() const { return (this->reactionUs + 500) / 1000; }
};

struct ArmCommand {
    Protocol::PodMode mode = Protocol::PodMode::HIT;
    uint8_t colorActive = Protocol::Color::GREEN;
    uint8_t colorAfter = Protocol::Color::OFF;
    int64_t startAtUs = 0;              // network time (see nowUs), 0 = immediately
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
};
