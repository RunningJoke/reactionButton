#include "BlockFactory.h"

BlockFactory* BlockFactory::factory = nullptr;

BlockFactory* BlockFactory::getFactory() {
    if(BlockFactory::factory == nullptr) {
        BlockFactory::factory = new BlockFactory();
    }
    return BlockFactory::factory;
}


BlockFactory::BlockFactory() {
    // Constructor implementation
}

VBlock* BlockFactory::createBlock(IBlockConfiguration* blockConfiguration) {
    switch (blockConfiguration->getBlockType()) {
    case BlockType::DELAY:
        return new DelayBlock(blockConfiguration);
        break;  
    case BlockType::WAIT_FOR_PRESS:
        // Create and return a WaitForPress block
        return nullptr;
        break; 
    case BlockType::COUNTDOWN:
        // Create and return a Countdown block
        return nullptr;
        break;  
    case BlockType::LED:
        // Create and return a LED block
        return new LEDBlock(blockConfiguration);
        break;    
    }

    return nullptr;
}


