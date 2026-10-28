#ifndef TOGGLEBLOCK_H
#define TOGGLEBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Block/Countdown.h"
#include "Link/Protocol.h"

/**
 * Team game: every press flips a pod between two team colours (programs.md §2, §7.15).
 *
 *   { "type": "toggle", "pods": "NODE_COUNT", "includeCentral": true,
 *     "colors": ["red", "blue"], "start": "alternate", "durationMs": 60000, "cooldownMs": 500,
 *     "countdown": "secret", "storeA": "RED_PODS", "storeB": "BLUE_PODS",
 *     "storeTimeA": "RED_MS", "storeTimeB": "BLUE_MS", "storeFlips": "FLIPS",
 *     "next": "Result", "allA": "RedWins", "allB": "BlueWins" }
 *
 * The pods flip locally (PodMode::TOGGLE) and report the owner with every flip; the central
 * keeps owner, owned time and flip count per pod. The central's own button takes part with
 * includeCentral. Ends when durationMs has passed (next), or when all pods have one colour
 * and the port allA / allB is connected. Afterwards the pods stay lit in their final colour,
 * frozen: follow with remoteResetAll.
 */
class ToggleBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, ALL_A, ALL_B, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        enum { MAX_PODS = 31 };     // peripherals; the central is one more, index podCount
        enum class Start : uint8_t { A, B, ALTERNATE, RANDOM, OFF };

        uint8_t colorOf(uint8_t owner) const;
        void showCentral(BlockContext& ctx);
        void flip(uint8_t index, uint8_t owner, int64_t atUs);
        bool allSame(uint8_t owner) const;
        BlockStatus finish(BlockContext& ctx, int64_t atUs, uint8_t port);

        Value pods;
        bool includeCentral = true;
        uint8_t colorA = Protocol::Color::RED;
        uint8_t colorB = Protocol::Color::BLUE;
        Start start = Start::ALTERNATE;
        Value durationMs;
        Value minDurationMs;
        Value maxDurationMs;
        Value cooldownMs = Value(300);
        Value syncStartMs = Value(20);
        Countdown countdown;
        VarId storeA = -1;
        VarId storeB = -1;
        VarId storeTimeA = -1;
        VarId storeTimeB = -1;
        VarId storeFlips = -1;

        uint8_t podCount = 0;
        uint32_t participants = 0;      // bit i: pod i takes part, bit podCount: the central
        uint8_t cmdSeqs[MAX_PODS];
        uint8_t owner[MAX_PODS + 1];
        uint16_t flips[MAX_PODS + 1];
        int64_t changedUs[MAX_PODS + 1];    // when the owner of the index last changed
        int64_t teamUs[2];                  // owned time per team, summed over the pods
        uint32_t cooldownMsAtEnter = 0;
        Protocol::EffectDesc centralCountdown = {Protocol::EffectId::NONE, 0, 0, 0, 0, 0, 0, 0};
        int64_t startAtUs = 0;          // network time when all pods light up
        int64_t endAtUs = 0;
        bool centralLit = false;
        uint32_t pressCountAtLight = 0;
        int64_t centralLastFlipUs = 0;
};

#endif
