#include "RepeatBlock.h"

const char* RepeatBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "body", "done"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool RepeatBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->count.parse(json["count"], ctx.vars) || !this->count.isSet()) {
        return ctx.fail("missing 'count'");
    }
    const char* storeIndex = json["storeIndex"];
    if(storeIndex != nullptr) {
        this->indexVar = ctx.vars.resolve(storeIndex);
    }
    return true;
}

BlockStatus RepeatBlock::execute(BlockContext& ctx) {
    // Counted here, not in enter(): an instant block is executed exactly once per entry,
    // while a pause (restartCurrentBlock) re-enters the block before it was executed.
    this->counter++;
    if(this->counter <= this->count.get(ctx.vars)) {
        if(this->indexVar >= 0) {
            ctx.vars.set(this->indexVar, this->counter);
        }
        return BlockStatus::done(BODY);
    }
    this->counter = 0;
    return BlockStatus::done(DONE);
}
