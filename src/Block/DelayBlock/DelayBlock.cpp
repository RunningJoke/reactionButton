#include "DelayBlock.h"

DelayBlock::DelayBlock(DelayBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<DelayBlockConfiguration*>(blockConfiguration);
    this->genericBlockConfiguration = blockConfiguration;
}

DelayBlock::~DelayBlock() {
    // Destructor implementation
}   

block_err_t DelayBlock::enterBlock() {
    this->timestamp = millis();
    return 0;
}

block_err_t DelayBlock::executeBlock() {
        
    uint64_t delayTime = (uint64_t)random(this->blockConfiguration->minDelay , this->blockConfiguration->maxDelay);

    ESP_LOGI("DELAYBLOCK", "Delay for %u%u", (uint32_t)(delayTime >> 32) , (uint32_t)(delayTime));

    vTaskDelay(delayTime / portTICK_PERIOD_MS);
    return 0;
}

