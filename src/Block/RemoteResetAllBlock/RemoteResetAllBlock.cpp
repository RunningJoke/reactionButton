#include "RemoteResetAllBlock.h"
#include "BLEManager/IBuzzerMode.h"
#include "Peripheral/Peripheral.h"

bool RemoteResetAllBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->pods.parse(json["pods"], ctx.vars)) {
        return ctx.fail("invalid 'pods'");
    }
    this->ledsOff = json["ledsOff"] | true;
    return true;
}

BlockStatus RemoteResetAllBlock::execute(BlockContext& ctx) {
    if(ctx.remote != nullptr) {
        int64_t connected = ctx.remote->getPeripheralCount();
        int64_t count = this->pods.isSet() ? constrain(this->pods.get(ctx.vars), (int64_t)0, connected) : connected;

        for(uint8_t i = 0; i < count; i++) {
            Peripheral* peripheral = ctx.remote->getPeripheral(i);
            if(peripheral != nullptr) {
                peripheral->resetPeripheral();
            }
        }
    }

    if(this->ledsOff) {
        ctx.leds.turnOff();
    }
    return BlockStatus::done();
}
