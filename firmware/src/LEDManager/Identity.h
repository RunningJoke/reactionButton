#pragma once

#include <stdint.h>
#include "Link/Protocol.h"

/**
 * Pod identity (firmware >= 2.13, issue #20; light language #82, fw >= 2.15): a pod is shown by its
 * number and colour, so that the pods of a set can be told apart.
 *
 *   number   1 ... 7 (pod id + 1; ids are handed out in claim order)
 *   colour   fixed per pod id. The palette has no red / green (game signals), no amber (attention) and
 *            no white (confirmation); the central has no number
 *   pattern  one light at position n (pod 3 = LED 2), see SystemPattern JOINED: two flashes after a claim,
 *            then dim while the central is in the menu, discovery or confirm (PONG_FLAG_IDENTIFY)
 */
namespace Identity {
    const uint8_t COUNT = 7;
    const uint8_t PALETTE[COUNT] = {
        Protocol::Color::BLUE, Protocol::Color::CYAN, Protocol::Color::VIOLET, Protocol::Color::MAGENTA,
        Protocol::Color::YELLOW, Protocol::Color::ORANGE, Protocol::Color::CREAM
    };
    const uint8_t CENTRAL_COLOR = Protocol::Color::WHITE;

    const uint32_t BLINK_MS = 2000;             // "blink a pod" (config API op blink)
    const uint16_t BLINK_PERIOD_MS = 500;

    inline uint8_t colorOf(uint8_t podId) { return PALETTE[podId % COUNT]; }
    inline uint8_t numberOf(uint8_t podId) { return podId + 1; }
    // LED that shows the pod (pod 1 = LED 0)
    inline uint8_t ledOf(uint8_t podId) { return podId % COUNT; }
}
