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

block_err_t VBlock::enterBlock() {
    return 0;
}

block_err_t VBlock::exitBlock() {
    return 0;
}