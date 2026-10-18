#ifndef SETVARIABLEBLOCK_H
#define SETVARIABLEBLOCK_H

#include <Arduino.h>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Changes a variable and continues immediately.
 *
 *   { "type": "setVariable", "var": "RUNS", "op": "+", "value": 1, "next": "..." }
 *
 * op:
 *   "=" / "set"            var = value
 *   "+" / "add"            var += value
 *   "-" / "sub"            var -= value
 *   "random" / "?"         var = random in [0, value)
 *   "randomOther" / "!"    like random, but different from the current value
 * value: number or variable name.
 */
class SetVariableBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        enum class Op : uint8_t { SET, ADD, SUB, RANDOM, RANDOM_OTHER };

        VarId var = -1;
        Op op = Op::SET;
        Value value;
};

#endif
