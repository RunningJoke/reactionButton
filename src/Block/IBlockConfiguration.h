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

class IBlockConfiguration
{
private:
    String blockName;
    BlockType blockType;
    String nextBlockName;
public:
    virtual String getBlockName();
    virtual BlockType getBlockType();
    virtual String getNextBlockName();

    // Add other necessary methods and properties
};



#endif