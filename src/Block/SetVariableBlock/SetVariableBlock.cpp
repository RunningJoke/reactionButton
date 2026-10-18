#include "SetVariableBlock.h"
#include "Block/RandomUtil.h"

bool SetVariableBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    const char* varName = json["var"];
    if(varName == nullptr) {
        return ctx.fail("missing 'var'");
    }
    this->var = ctx.vars.resolve(varName);

    if(!this->value.parse(json["value"], ctx.vars) || !this->value.isSet()) {
        return ctx.fail("missing 'value'");
    }

    const char* op = json["op"] | "=";
    if(strcmp(op, "=") == 0 || strcmp(op, "set") == 0) this->op = Op::SET;
    else if(strcmp(op, "+") == 0 || strcmp(op, "add") == 0) this->op = Op::ADD;
    else if(strcmp(op, "-") == 0 || strcmp(op, "sub") == 0) this->op = Op::SUB;
    else if(strcmp(op, "?") == 0 || strcmp(op, "random") == 0) this->op = Op::RANDOM;
    else if(strcmp(op, "!") == 0 || strcmp(op, "randomOther") == 0) this->op = Op::RANDOM_OTHER;
    else return ctx.fail("unknown 'op'");

    return true;
}

BlockStatus SetVariableBlock::execute(BlockContext& ctx) {
    int64_t current = ctx.vars.get(this->var);
    int64_t value = this->value.get(ctx.vars);

    switch(this->op) {
        case Op::SET:
            ctx.vars.set(this->var, value);
            break;
        case Op::ADD:
            ctx.vars.set(this->var, current + value);
            break;
        case Op::SUB:
            ctx.vars.set(this->var, current - value);
            break;
        case Op::RANDOM:
            ctx.vars.set(this->var, RandomUtil::below(value));
            break;
        case Op::RANDOM_OTHER:
        {
            int64_t result = RandomUtil::below(value);
            // only possible to pick a different value if there are at least 2 options
            if(value >= 2 && current >= 0 && current < value) {
                // pick from the value-1 other options, skipping the current one
                result = RandomUtil::below(value - 1);
                if(result >= current) {
                    result++;
                }
            }
            ctx.vars.set(this->var, result);
            break;
        }
    }
    return BlockStatus::done();
}
