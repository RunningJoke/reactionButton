#ifndef IFBLOCK_H
#define IFBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Compares two values and branches.
 *
 *   { "type": "if", "left": "RUNS", "op": ">=", "right": "MAX_LOOPS",
 *     "true": "StartReset", "false": "StartLoop" }
 *
 * op: "==", "!=", ">", "<", ">=", "<=". left/right: number or variable name.
 */
class IfBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return 2; }
        const char* portName(uint8_t port) const override { return port == 0 ? "true" : "false"; }

    protected:
        enum class Op : uint8_t { EQ, NE, GT, LT, GE, LE };

        Value left;
        Value right;
        Op op = Op::EQ;
};

#endif
