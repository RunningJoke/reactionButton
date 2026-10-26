#ifndef EFFECTBLOCK_H
#define EFFECTBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Block/EffectTarget.h"
#include "Link/Protocol.h"

/**
 * Plays a ring effect on the central and / or peripherals (programs.md §2, §7.11).
 *
 *   { "type": "effect", "target": "all", "effect": "pulse", "color": "blue",
 *     "periodMs": 500, "durationMs": 2000, "wait": true, "next": "Go" }
 *
 * target: "central" (default), "all", "peripherals" or a pod id (value).
 * effect: solid fill drain dim colorShift trafficLight blink pulse spin off.
 * wait false: starts the effect and continues at once. wait true: continues when
 * the effect has ended (start + syncStartMs + durationMs).
 *
 * All values are read in the pass the block is entered (the block executes once for
 * wait false). A later led / ARM / RESET on the same ring replaces the effect.
 */
class EffectBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        EffectTarget target;
        Protocol::EffectId effect = Protocol::EffectId::NONE;
        bool off = false;               // "off": a solid, dark ring
        uint8_t color = Protocol::Color::WHITE;
        uint8_t color2 = Protocol::Color::OFF;
        Value durationMs;
        Value periodMs = Value(500);
        Value brightness = Value(255);
        Value syncStartMs = Value(20);
        uint32_t ledMask = 0;           // central only; 0 = all LEDs
        bool wait = false;

        bool started = false;
        int64_t endUs = 0;
};

#endif
