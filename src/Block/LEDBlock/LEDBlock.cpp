#include "LEDBlock.h"

LEDBlock::LEDBlock(LEDBlockConfiguration* blockConfiguration) {
    this->genericBlockConfiguration = blockConfiguration;
    this->blockConfiguration = blockConfiguration;
}

LEDBlock::~LEDBlock() {
    // Destructor implementation
}

block_err_t LEDBlock::executeBlock() {
    LEDManager* ledManager = LEDManager::getManager();
    ledManager->setLEDColors(this->blockConfiguration->color);
    return 0;
}