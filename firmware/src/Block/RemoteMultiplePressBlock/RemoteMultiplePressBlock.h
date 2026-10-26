#ifndef REMOTE_MULTIPLE_PRESSBLOCK_H
#define REMOTE_MULTIPLE_PRESSBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Block/Countdown.h"
#include "ColorSet/ColorSet.h"
#include "Link/Protocol.h"

/**
 * Lights several pods at the same moment. "avoid" random pods are red and must not be
 * pressed; all others are green and must be pressed.
 *
 *   { "type": "remoteMultiPress",
 *     "pods": "REQUIRED_PERIPHERALS",  number of peripherals to use (default: all connected)
 *     "avoid": "AVOID_COUNT",          number of red pods (default 0, at least one pod stays green)
 *     "includeCentral": true,          the central takes part as one more pod
 *     "hitColor": "green", "avoidColor": "red",
 *     "syncStartMs": 20,               lead time: all pods light together this long after the
 *                                      block starts (time for the commands to arrive)
 *     "timeoutMs": 10000,              optional
 *     "countdown": "drain",            all lit pods and the central count down together over the
 *     "countdownColor": "red",         timeout (needs timeoutMs, read once on enter), see
 *                                      programs.md §7.12
 *     "record": "reaction",            record the reaction time of every green pod
 *     "next": "...",                   all green pods pressed
 *     "avoidHit": "...",               a red pod was pressed
 *     "timeout": "..." }
 *
 * Pods that were not pressed stay lit; follow with a "remoteResetAll" block.
 */
class RemoteMultiplePressBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, AVOID_HIT, TIMEOUT, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        enum { MAX_PODS = 31 }; // one bit per pod in a uint32_t, the central uses bit podCount

        Value pods;
        Value avoid = Value(0);
        Value syncStartMs = Value(20);
        bool includeCentral = true;
        uint8_t remoteHitColor = Protocol::Color::GREEN;
        uint8_t remoteAvoidColor = Protocol::Color::RED;
        ColorSet localHitColor = {0, 255, 0};
        ColorSet localAvoidColor = {255, 0, 0};
        Value timeoutMs;
        Countdown countdown;
        int64_t timeoutAtEnter = 0;     // timeoutMs read on enter (used with a countdown)
        Protocol::EffectDesc centralCountdown = {Protocol::EffectId::NONE, 0, 0, 0, 0, 0, 0, 0};
        std::string recordMetric;

        uint8_t podCount = 0;
        uint8_t cmdSeqs[MAX_PODS];
        uint32_t avoidMask = 0;
        uint32_t remainingMask = 0;
        int64_t startAtUs = 0;          // network time when all pods light up
        bool centralLit = false;
        int64_t centralLitUs = 0;
        uint32_t pressCountAtLight = 0;
        uint32_t enterTime = 0;
};

#endif
