#include "BlockManager.h"

BlockManager* BlockManager::manager = nullptr;

BlockManager* BlockManager::getManager() {

    if(BlockManager::manager == nullptr) {        
        ESP_LOGI("BLOCKMANAGER", "Initializing Block manager");
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
    this->currentBlockIndex = this->findIndex(blockName);
};

uint32_t BlockManager::findIndex(String blockName) {
    for (uint32_t i = 0; i < this->blockCount; i++) {
        if (this->blockList[i]->getBlockName() == blockName) {
            return i;
        }
    }
    return 0xFF;
}

void BlockManager::runBlocks() {
    this->blockList[this->currentBlockIndex]->executeBlock();
    const char* nextBlockName = this->blockList[this->currentBlockIndex]->getBlockConfiguration()->getNextBlockName();

    ESP_LOGD("BLOCKMANAGER", "Next block name: %s", nextBlockName);
    uint32_t nextBlockIndex = this->findIndex(nextBlockName);

    if(this->currentBlockIndex != nextBlockIndex) {
        //handle beforeExit and beforeEnter if block changed
        this->blockList[this->currentBlockIndex]->exitBlock();
        this->blockList[nextBlockIndex]->enterBlock();

        this->currentBlockIndex = nextBlockIndex;
    }
    return;
}
