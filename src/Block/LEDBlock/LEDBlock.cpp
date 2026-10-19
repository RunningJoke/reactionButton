#include "LEDBlock.h"
#include "Block/JsonUtil.h"

bool LEDBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!JsonUtil::parseColor(json["color"], this->color)) {
        return ctx.fail("missing or invalid 'color'");
    }
    for(JsonVariantConst led : json["leds"].as<JsonArrayConst>()) {
        uint8_t index = led.as<uint8_t>();
        if(index >= NEOPIXEL_SIZE) {
            return ctx.fail("led index out of range");
        }
        this->leds.push_back(index);
    }
    return true;
}

BlockStatus LEDBlock::execute(BlockContext& ctx) {
    if(this->leds.empty()) {
        ctx.leds.setLEDColors(&this->color);
    } else {
        for(uint8_t index : this->leds) {
            ctx.leds.setLEDColors(index, &this->color);
        }
    }
    return BlockStatus::done();
}
