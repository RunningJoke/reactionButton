#include "IBlockConfiguration.h"


String IBlockConfiguration::getBlockName() {
    return this->blockName;
}

BlockType IBlockConfiguration::getBlockType() {
    return this->blockType;
}

String IBlockConfiguration::getNextBlockName() {
    return this->nextBlockName;
}

