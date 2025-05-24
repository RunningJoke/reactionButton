#include "DelayBlock.h"

DelayBlock::DelayBlock(IBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<DelayBlockConfiguration*>(blockConfiguration);
}

DelayBlock::~DelayBlock() {
    // Destructor implementation
}   

block_err_t DelayBlock::executeBlock() {
    uint64_t delayTime = this->blockConfiguration->delay;
    vTaskDelay(delayTime / portTICK_PERIOD_MS);
    return 0;
}

String DelayBlock::getBlockName() {
    return this->blockConfiguration->getBlockName();
}

IBlockConfiguration* DelayBlock::getBlockConfiguration() {
    return this->blockConfiguration;
}
