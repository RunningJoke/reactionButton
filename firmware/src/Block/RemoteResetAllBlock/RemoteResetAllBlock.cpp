#include "RemoteResetAllBlock.h"
#include "Link/IPodNetwork.h"

bool RemoteResetAllBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pods.parse(json["pods"], ctx.vars)) {
        return ctx.fail("invalid 'pods'");
    }
    this->ledsOff = json["ledsOff"] | true;
    return true;
}

BlockStatus RemoteResetAllBlock::execute(BlockContext& ctx) {
    if(ctx.network != nullptr) {
        int64_t connected = ctx.network->podCount();
        int64_t count = this->pods.isSet() ? constrain(this->pods.get(ctx.vars), (int64_t)0, connected) : connected;

        for(uint8_t i = 0; i < count; i++) {
            ctx.network->reset(i);
        }
    }

    if(this->ledsOff) {
        ctx.leds.turnOff();
    }
    return BlockStatus::done();
}
