#ifndef REMOTE_PRESSBLOCK_H
#define REMOTE_PRESSBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Link/Protocol.h"

/**
 * Lights one peripheral and waits until it is pressed.
 *
 *   { "type": "remotePress",
 *     "pod": "SELECTED_BUZZER",    peripheral index (number or variable)
 *     "mode": "hit",               "hit" or "avoid"
 *     "color": "green",            colour while waiting (named colours only)
 *     "colorAfter": "off",         colour after the press
 *     "timeoutMs": 5000,           optional
 *     "record": "reaction",        record the reaction time measured by the peripheral
 *     "storeAs": "LAST_REACTION",  also write it into a variable
 *     "next": "...",               pressed
 *     "timeout": "..." }           not pressed in time (or pod not available)
 *
 * Only the press that belongs to this activation counts (matched by command sequence).
 */
class RemotePressBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, TIMEOUT, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override { return port == NEXT ? "next" : "timeout"; }

    protected:
        Value pod;
        bool avoid = false;
        uint8_t colorActive = Protocol::Color::GREEN;
        uint8_t colorAfter = Protocol::Color::OFF;
        Value timeoutMs;
        std::string recordMetric;
        VarId storeVar = -1;

        bool armed = false;
        uint8_t podId = 0;
        uint8_t cmdSeq = 0;
        uint32_t enterTime = 0;
};

#endif
