#ifndef LEDBLOCK_H
#define LEDBLOCK_H

#include <Arduino.h>
#include <vector>
#include "Block/Block.h"
#include "ColorSet/ColorSet.h"

/**
 * Sets LEDs on the central and continues immediately.
 *
 *   { "type": "led", "color": "green", "leds": [0, 1, 2], "next": "..." }
 *
 * color: name, "#RRGGBB" or [r, g, b]. leds: optional list of LED indices; all LEDs if missing.
 */
class LEDBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        ColorSet color = {0, 0, 0};
        std::vector<uint8_t> leds;
};

#endif
