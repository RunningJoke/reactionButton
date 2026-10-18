#ifndef BUTTONBLOCK_H
#define BUTTONBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Waits for the central's own button.
 *
 *   { "type": "button",
 *     "pressed": "...",            leave on the press edge (fastest, use for reaction games)
 *     "short":   "...",            leave on release if held < shortMs
 *     "long":    "...",            leave on release if held >= shortMs
 *     "next":    "...",            fallback for short/long
 *     "timeout": "...",            leave if no press within the timeout
 *     "shortMs": 1000,
 *     "timeoutMs": 3000            or "minTimeoutMs" + "maxTimeoutMs" for a random timeout
 *     "record": "reaction",        record press time - block entry time as a result
 *     "storeAs": "LAST_REACTION" } also write that time into a variable
 *
 * Only presses that start after the block was entered count. A button that is still
 * held from an earlier step is ignored until it is released and pressed again.
 */
class ButtonBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, SHORT, LONG, PRESSED, TIMEOUT, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        Value shortMs = Value(1000);
        Value minTimeoutMs;
        Value maxTimeoutMs;
        std::string recordMetric;
        VarId storeVar = -1;

        uint32_t enterTime = 0;
        uint32_t pressCountAtEnter = 0;
        uint32_t timeout = 0;
        bool pressed = false;
};

#endif
