#ifndef REMOTE_PRESS_BLOCK_CONFIGURATION_H
#define REMOTE_PRESS_BLOCK_CONFIGURATION_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/RemotePressBlock/RemotePressBlock.h"

struct RemotePressBlockConfiguration : public IBlockConfiguration {
    const char* peripheralIdVariableName = nullptr;
    RemotePressBlock* parentBlock = nullptr;

    RemotePressBlockConfiguration(const char* blockName, const char* nextBlockName, const char* peripheralIdVariableName)
        : IBlockConfiguration(blockName, BlockType::REMOTE_PRESS, nextBlockName) {
            this->peripheralIdVariableName = peripheralIdVariableName;
        }

    const char* getNextBlockName() override {
        if (this->parentBlock->activated) {
            return this->nextBlockName;
        }
        return this->blockName; 
    }
};

#endif