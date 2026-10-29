#pragma once

#include <stdint.h>
#include "Link/Protocol.h"

/**
 * Pod identity (firmware >= 2.13, issue #20): a pod is shown by its number and colour, so that the
 * pods of a set can be told apart.
 *
 *   number   1 ... 7 (pod id + 1; ids are handed out in claim order)
 *   colour   fixed per pod id. The palette has no yellow (waiting for a central) and no white (the central)
 *   pattern  `number` LEDs in the colour, the rest dark. Shown for FLASH_US after a claim, and as a slow
 *            spin while the central is in the menu, discovery or confirm (PONG_FLAG_IDENTIFY)
 *
 * An unclaimed pod shows yellow with one segment of UNCLAIMED_SEGMENT LEDs in a colour and at a position
 * derived from its MAC, so that unclaimed pods can be told apart too.
 */
namespace Identity {
    const uint8_t COUNT = 7;
    const uint8_t PALETTE[COUNT] = {
        Protocol::Color::RED, Protocol::Color::GREEN, Protocol::Color::BLUE, Protocol::Color::MAGENTA,
        Protocol::Color::CYAN, Protocol::Color::ORANGE, Protocol::Color::VIOLET
    };
    const uint8_t CENTRAL_COLOR = Protocol::Color::WHITE;

    const int64_t FLASH_US = 1500000;           // static pattern after a claim
    const uint16_t SPIN_PERIOD_MS = 3000;       // one turn of the spin
    const uint32_t BLINK_MS = 2000;             // "blink a pod" (config API op blink)
    const uint16_t BLINK_PERIOD_MS = 500;
    const uint8_t UNCLAIMED_SEGMENT = 2;

    inline uint8_t colorOf(uint8_t podId) { return PALETTE[podId % COUNT]; }
    inline uint8_t numberOf(uint8_t podId) { return podId + 1; }
}
