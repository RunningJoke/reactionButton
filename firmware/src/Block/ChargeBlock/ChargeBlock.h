#ifndef CHARGEBLOCK_H
#define CHARGEBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/HoldBlock.h"
#include "Block/Countdown.h"

/**
 * Hold the button to charge (programs.md §2, §7.13).
 *
 *   { "type": "charge", "pod": "central", "onsetMs": 200, "maxMs": 2000, "style": "fill", "color": "green",
 *     "mode": "release", "storeAs": "CHARGE", "record": "charge",
 *     "released": "Score", "early": "TooSoon", "full": "Overcharged", "timeout": "Missed" }
 *
 * pod: "central" (default) or a peripheral id (value). style: fill, brightness, trafficLight,
 * colorShift (+ color2). mode "release": releasing ends the block; "accumulate": releasing
 * pauses the charge (or drains it, decayMs), the block ends at full or at the timeout.
 * timeoutMs, or minTimeoutMs + maxTimeoutMs, counts from the entry (0 = none); countdown
 * (needs a timeout) runs on the idle ring until the first hold.
 *
 * The hold is measured and animated by HoldSession: on the central's own button, or on the
 * peripheral that gets the parameters in ARM (PodMode::CHARGE). All values are read on enter.
 */
class ChargeBlock : public HoldBlock {
    public:
        enum Port : uint8_t { NEXT = 0, RELEASED, EARLY, FULL, TIMEOUT, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        enum class Style : uint8_t { FILL, BRIGHTNESS, TRAFFIC_LIGHT, COLOR_SHIFT };

        // Ring brightness of the idle ring and start of the "brightness" style (0 .. 255)
        static const uint8_t DIM_LEVEL = 40;
        // After its own timeout an accumulating charge waits this long for the pod's final report
        static const uint32_t LIMIT_GRACE_MS = 300;

        void finish(BlockContext& ctx, uint32_t chargeMs);

        Value onsetMs = Value(0);
        Value maxMs;
        Value decayMs = Value(0);
        Style style = Style::FILL;
        uint8_t color = Protocol::Color::GREEN;
        uint8_t color2 = Protocol::Color::RED;
        bool accumulate = false;
        Value minTimeoutMs;
        Value maxTimeoutMs;
        Countdown countdown;
        std::string recordMetric;
        VarId storeVar = -1;
        VarId storePercentVar = -1;

        bool armed = false;
        uint32_t enterTime = 0;
        uint32_t timeout = 0;           // ms, 0 = none
        uint32_t maxChargeMs = 1;       // maxMs read on enter
        bool waitingForLimit = false;
        uint32_t limitDeadline = 0;
};

#endif
