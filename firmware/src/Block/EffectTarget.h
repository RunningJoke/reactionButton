#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Link/Protocol.h"

/**
 * Where an effect is shown: "central", "all" (central + all peripherals), "peripherals" or
 * a pod id (value; the central's own id means the central). Used by the effect block and
 * by the countdown of the delay block.
 */
class EffectTarget {
    public:
        // Missing field = central. False for any other JSON type.
        bool parse(JsonVariantConst json, VariableManager& vars);

        // Plays the effect on the target, starting at startAtUs (network time, 0 = now).
        // ledMask applies to the central only. A pod without effect support (older firmware)
        // gets a static colour (staticFallback; EffectId::NONE and colour off reset it) or
        // nothing.
        void play(BlockContext& ctx, const Protocol::EffectDesc& effect, int64_t startAtUs,
                  uint32_t ledMask, bool staticFallback) const;

        // True if the central shows the effect (it is stopped when the block is left)
        bool includesCentral(BlockContext& ctx) const;

        // True if peripherals can be part of the target
        bool includesPeripherals() const { return this->mode != Mode::CENTRAL; }

        // Network time now (= local time on the central)
        static int64_t nowUs(BlockContext& ctx);

    private:
        enum class Mode : uint8_t { CENTRAL, ALL, PERIPHERALS, POD };

        Mode mode = Mode::CENTRAL;
        Value pod;
};
