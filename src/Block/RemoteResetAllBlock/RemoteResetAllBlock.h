#ifndef REMOTE_RESET_ALL_BLOCK_H
#define REMOTE_RESET_ALL_BLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Resets (switches off) peripherals and continues immediately.
 *
 *   { "type": "remoteResetAll", "pods": 3, "ledsOff": true, "next": "..." }
 *
 * pods: number of peripherals to reset (default: all connected).
 * ledsOff: also switch off the central's own LEDs (default true).
 */
class RemoteResetAllBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        Value pods;
        bool ledsOff = true;
};

#endif
