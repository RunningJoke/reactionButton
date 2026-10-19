#include "DelayBlock.h"
#include "Block/RandomUtil.h"

bool DelayBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!json["ms"].isNull()) {
        if(!this->minMs.parse(json["ms"], ctx.vars)) {
            return ctx.fail("invalid 'ms'");
        }
        this->maxMs = this->minMs;
        return true;
    }
    if(!this->minMs.parse(json["minMs"], ctx.vars) || !this->maxMs.parse(json["maxMs"], ctx.vars)
        || !this->minMs.isSet() || !this->maxMs.isSet()) {
        return ctx.fail("needs 'ms' or 'minMs' + 'maxMs'");
    }
    return true;
}

void DelayBlock::enter(BlockContext& ctx) {
    int64_t duration = RandomUtil::between(this->minMs.get(ctx.vars), this->maxMs.get(ctx.vars));
    this->until = millis() + (uint32_t)duration;
}

BlockStatus DelayBlock::execute(BlockContext& ctx) {
    if((int32_t)(millis() - this->until) >= 0) {
        return BlockStatus::done();
    }
    return BlockStatus::running();
}
