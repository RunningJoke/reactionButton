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
    case BlockType::REMOTE_PRESS:
        // Create and return a Remote Press block
        return new RemotePressBlock(static_cast<RemotePressBlockConfiguration*>(blockConfiguration));
        break;
    case BlockType::REMOTE_MULTIPLE_PRESS:
        return new RemoteMultiplePressBlock(static_cast<RemoteMultiplePressBlockConfiguration*>(blockConfiguration));
        break;
    case BlockType::REMOTE_RESET:
        return new RemoteResetAllBlocks(static_cast<RemoteResetAllBlocksConfiguration*>(blockConfiguration));
        break;
    case BlockType::IF:
        return new IfBlock(static_cast<IfBlockConfiguration*>(blockConfiguration));
        break;
    case BlockType::SET_VARIABLE:
        return new SetVariableBlock(static_cast<SetVariableBlockConfiguration*>(blockConfiguration));
        break;
    }

    return nullptr;
}


