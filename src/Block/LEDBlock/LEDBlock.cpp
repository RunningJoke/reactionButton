#include "LEDBlock.h"

LEDBlock::LEDBlock(IBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<LEDBlockConfiguration*>(blockConfiguration);
    LEDManager* ledManager = LEDManager::getManager();
}

LEDBlock::~LEDBlock() {
    // Destructor implementation
}

block_err_t LEDBlock::executeBlock() {
    LEDManager* ledManager = LEDManager::getManager();
    ledManager->setLEDColors(&this->blockConfiguration->color);
    return 0;
}

String LEDBlock::getBlockName() {
    return this->blockConfiguration->getBlockName();
}

IBlockConfiguration* LEDBlock::getBlockConfiguration() {
    return this->blockConfiguration;
}