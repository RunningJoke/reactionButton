#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Block/Block.h"
#include "Link/Protocol.h"

/**
 * The "countdown" option of the timed blocks (delay, button, remotePress, remoteMultiPress),
 * programs.md §2 and §7.12:
 *
 *   "countdown": "secret" | "drain" | "fill" | "dim" | "colorShift" | "trafficLight"
 *   "countdownColor": "red"       end colour of colorShift
 *   "countdownFrom": "green"      delay / button only: start colour (they have no lit colour)
 *
 * The countdown is a ring effect (Protocol::EffectDesc) that runs over the time limit of
 * the block. The block plays it on the central (LEDManager::playEffect) and on peripherals
 * (ArmCommand::waiting or IPodNetwork::effect).
 */
struct Countdown {
    enum class Style : uint8_t { SECRET, DRAIN, FILL, DIM, COLOR_SHIFT, TRAFFIC_LIGHT };

    Style style = Style::SECRET;
    uint8_t endColor = Protocol::Color::RED;
    uint8_t fromColor = Protocol::Color::GREEN;

    // Reads the fields from a block's JSON. Returns ctx.fail(...) on invalid input.
    bool parse(JsonObjectConst json, BlockLoadContext& ctx);

    bool active() const { return this->style != Style::SECRET; }

    // The effect for a time limit of durationMs that starts with litColor. False (nothing to
    // play) for "secret" and for a duration of 0.
    bool describe(uint8_t litColor, uint32_t durationMs, Protocol::EffectDesc& out) const;
};
