#include "BlockManager.h"

BlockManager* BlockManager::manager = nullptr;

BlockManager* BlockManager::getManager() {
    if(BlockManager::manager == nullptr) {
        BlockManager::manager = new BlockManager();
    }

    return BlockManager::manager;
};

block_err_t BlockManager::assignBlock(IBlockConfiguration* blockConfiguration) {
    if(blockCount >= MAX_BLOCK_NUMBER) {
        return -1; // No more blocks available
    }

    blockList[blockCount] = BlockFactory::getFactory()->createBlock(blockConfiguration);
    blockCount++;

    return 0;
}

int32_t BlockManager::findNextBlockIndex() {
    for (uint32_t i = 0; i < blockCount; i++) {
        if (blockList[i]->getBlockName() == blockList[currentBlockIndex]->getBlockConfiguration()->getNextBlockName()) {
            return i;
        }
    }
    return -1; // Not found
}

BlockManager::BlockManager() {}; 

void BlockManager::defineStartBlock(String blockName) {
    for (uint32_t i = 0; i < blockCount; i++) {
        if (blockList[i]->getBlockName() == blockName) {
            break;
        }
    }
};

void BlockManager::runBlocks() {
    for (uint32_t i = 0; i < blockCount; i++) {
        blockList[i]->executeBlock();
    }
    return;
}
