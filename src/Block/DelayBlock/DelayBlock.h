#ifndef DELAYBLOCK_H
#define DELAYBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Waits without blocking the main loop.
 *
 *   { "type": "delay", "ms": 3000, "next": "..." }
 *   { "type": "delay", "minMs": 800, "maxMs": 5000, "next": "..." }   random, inclusive
 *
 * All durations may also be variable names.
 */
class DelayBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        Value minMs;
        Value maxMs;
        uint32_t until = 0;
};

#endif
