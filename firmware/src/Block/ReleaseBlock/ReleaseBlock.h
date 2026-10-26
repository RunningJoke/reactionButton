#ifndef RELEASEBLOCK_H
#define RELEASEBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/HoldBlock.h"
#include "Block/Countdown.h"

/**
 * The release of the button is the event (programs.md §2, §7.14).
 *
 *   { "type": "release", "mode": "trigger", "pod": 0, "holdColor": "yellow",
 *     "storeAs": "HOLD_MS", "next": "Run", "noHold": "Idle" }
 *
 *   { "type": "release", "mode": "signal", "pod": 0, "holdColor": "yellow", "goColor": "green",
 *     "minGoMs": 1500, "maxGoMs": 3000, "timeoutMs": 1000, "record": "start",
 *     "next": "Run", "falseStart": "Foul", "noHold": "Idle", "timeout": "Late" }
 *
 * trigger: the athlete holds the pod, letting go is the event (next). signal: the athlete
 * holds, the colour switches after goMs (or a random time in minGoMs..maxGoMs, drawn on
 * enter), and the athlete must let go as fast as possible; the reaction is measured on the pod.
 * Unconnected noHold / falseStart / timeout fall back to next.
 *
 * The hold is measured by HoldSession on the central's own button or on the peripheral that
 * gets the parameters in ARM (PodMode::RELEASE). All values are read on enter.
 */
class ReleaseBlock : public HoldBlock {
    public:
        enum Port : uint8_t { NEXT = 0, NO_HOLD, FALSE_START, TIMEOUT, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        bool signal = false;
        uint8_t holdColor = Protocol::Color::YELLOW;
        uint8_t heldColor = Protocol::Color::YELLOW;
        uint8_t goColor = Protocol::Color::GREEN;
        bool allowHeld = true;
        Value holdTimeoutMs;
        Value maxHoldMs;
        Value minGoMs;
        Value maxGoMs;
        Value timeoutMs;
        Countdown countdown;
        std::string recordMetric;
        VarId storeVar = -1;

        bool armed = false;
        uint32_t enterTime = 0;
        uint32_t holdTimeout = 0;       // ms, 0 = none
        uint32_t maxHold = 0;           // trigger, 0 = none
        uint32_t goDelay = 0;           // signal
        uint32_t timeout = 0;           // signal, 0 = none
        bool holdStarted = false;
        int64_t holdStartUs = 0;        // central time the hold started (PRESSED receive time)
};

#endif
