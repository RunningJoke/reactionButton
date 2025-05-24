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
    switch (blockConfiguration->blockType) {
    case BlockType::DELAY:
        // Create and return a Delay block
        return new DelayBlock(static_cast<DelayBlockConfiguration*>(blockConfiguration));
        break;
    
    case BlockType::WAIT_FOR_PRESS:
        return new ButtonBlock(static_cast<ButtonBlockConfiguration*>(blockConfiguration));
        break; 
        
    case BlockType::COUNTDOWN:
        // Create and return a Countdown block
        return nullptr;
        break;  
    case BlockType::LED:
        // Create and return a LED block
        return new LEDBlock(static_cast<LEDBlockConfiguration*>(blockConfiguration));
        break;    
    }

    return nullptr;
}


