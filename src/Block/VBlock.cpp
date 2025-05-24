#include "VBlock.h"

String VBlock::getBlockName() {
    if(this->genericBlockConfiguration == nullptr) {
        return "Unknown Block";
    }
    return this->genericBlockConfiguration->blockName;
}

IBlockConfiguration* VBlock::getBlockConfiguration() {
    return this->genericBlockConfiguration;
}