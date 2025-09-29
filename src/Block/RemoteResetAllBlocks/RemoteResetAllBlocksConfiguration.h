#ifndef REMOTE_RESET_ALL_BLOCKS_CONFIGURATION_H
#define REMOTE_RESET_ALL_BLOCKS_CONFIGURATION_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/RemoteResetAllBlocks/RemoteResetAllBlocks.h"

struct RemoteResetAllBlocksConfiguration : public IBlockConfiguration {
    const char* peripheralCountVariableName = nullptr;

    RemoteResetAllBlocksConfiguration(const char* blockName, const char* nextBlockName, const char* peripheralCountVariableName)
        : IBlockConfiguration(blockName, BlockType::REMOTE_RESET, nextBlockName) {
            this->peripheralCountVariableName = peripheralCountVariableName;
        }
};

#endif