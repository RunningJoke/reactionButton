#ifndef REMOTE_MULTIPLE_PRESS_BLOCK_CONFIGURATION_H
#define REMOTE_MULTIPLE_PRESS_BLOCK_CONFIGURATION_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.h"

struct RemoteMultiplePressBlockConfiguration : public IBlockConfiguration {
    const char* peripheralCountVariableName = nullptr;
    const char* avoidCountVariableName = nullptr;
    const char* nextBlockIfAvoidHit = nullptr;
    RemoteMultiplePressBlock* parentBlock = nullptr;

    RemoteMultiplePressBlockConfiguration(const char* blockName, const char* nextBlockName, const char* peripheralCountVariableName, const char* avoidCountVariableName = nullptr, const char* nextBlockIfAvoidHit = nullptr)
        : IBlockConfiguration(blockName, BlockType::REMOTE_MULTIPLE_PRESS, nextBlockName) {
            this->peripheralCountVariableName = peripheralCountVariableName;
            this->avoidCountVariableName = avoidCountVariableName;
            this->nextBlockIfAvoidHit = nextBlockIfAvoidHit;
        }

    const char* getNextBlockName() override {
        if(this->parentBlock->avoidWasHit) {
            Serial.println("Avoid was hit, going to alternative next block");
            return this->nextBlockIfAvoidHit;
        }

        if (this->parentBlock->remainingCount == 0) {
            return this->nextBlockName;
        }
        return this->blockName; 
    }
};

#endif