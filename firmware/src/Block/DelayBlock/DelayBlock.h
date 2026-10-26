#ifndef DELAYBLOCK_H
#define DELAYBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Block/Countdown.h"
#include "Block/EffectTarget.h"

/**
 * Waits without blocking the main loop.
 *
 *   { "type": "delay", "ms": 3000, "next": "..." }
 *   { "type": "delay", "minMs": 800, "maxMs": 5000, "next": "..." }   random, inclusive
 *
 * All durations may also be variable names.
 *
 * Optional countdown over the duration (programs.md §7.12):
 *   "countdown": "drain", "countdownColor": "red", "countdownFrom": "green",
 *   "countdownTarget": "all"      central (default), all, peripherals or a pod id
 */
class DelayBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;
        void exit(BlockContext& ctx) override;

    protected:
        Value minMs;
        Value maxMs;
        Countdown countdown;
        EffectTarget countdownTarget;
        uint32_t until = 0;
        bool centralCounting = false;       // the central shows a countdown that exit() stops
};

#endif
