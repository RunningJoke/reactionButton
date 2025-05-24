#include "DelayBlock.h"

DelayBlock::DelayBlock(DelayBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<DelayBlockConfiguration*>(blockConfiguration);
    this->genericBlockConfiguration = blockConfiguration;
}

DelayBlock::~DelayBlock() {
    // Destructor implementation
}   

block_err_t DelayBlock::executeBlock() {
    uint64_t delayTime = this->blockConfiguration->delay;
    vTaskDelay(delayTime / portTICK_PERIOD_MS);
    return 0;
}

