#ifndef REPEATBLOCK_H
#define REPEATBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Counted loop. Leaves through "body" count times, then once through "done".
 *
 *   { "type": "repeat", "count": "MAX_LOOPS", "storeIndex": "RUNS",
 *     "body": "OneRound", "done": "Summary" }
 *
 * Every entry increments the block's own counter. While counter <= count it leaves
 * through "body" (storeIndex = counter, 1 .. count), otherwise it resets the counter to 0
 * and leaves through "done". count is read on every entry; count <= 0 goes straight to
 * "done". The body links back to this block. The counter is reset when the program
 * starts, not by a pause (restartCurrentBlock).
 */
class RepeatBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, BODY, DONE, PORT_COUNT };

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void onProgramStart() override { this->counter = 0; }
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

    protected:
        Value count;
        VarId indexVar = -1;
        int64_t counter = 0;
};

#endif
