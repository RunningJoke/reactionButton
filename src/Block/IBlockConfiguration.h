#ifndef IBLOCKCONFIGURATION_H
#define IBLOCKCONFIGURATION_H

#include <Arduino.h>
#include <string.h>

enum class BlockType {
    DELAY,
    WAIT_FOR_PRESS,
    COUNTDOWN,
    LED,
    // Add other block types as needed
} ;

struct IBlockConfiguration
{
    IBlockConfiguration(const char* blockName, BlockType blockType, const char* nextBlockName)
        : blockName(blockName), blockType(blockType), nextBlockName(nextBlockName) {}
        
    const char* blockName;
    BlockType blockType;
    const char* nextBlockName;

    virtual const char* getNextBlockName() {
        return nextBlockName;
    }
};



#endif