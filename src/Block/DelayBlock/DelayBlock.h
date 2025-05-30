#ifndef DELAYBLOCK_H
#define DELAYBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"


struct DelayBlockConfiguration : public IBlockConfiguration {
    uint32_t minDelay; // Delay in milliseconds
    uint32_t maxDelay; // Delay in milliseconds

    DelayBlockConfiguration(const char* blockName, const char* nextBlockName, uint32_t minDelay, uint32_t maxDelay = 0)
        : IBlockConfiguration(blockName, BlockType::DELAY, nextBlockName) {
            this->minDelay = minDelay;

            if(maxDelay == 0) {
                this->maxDelay = minDelay;
            } else {
                this->maxDelay = maxDelay;
            }
        }
};

class DelayBlock : public VBlock {

    protected:
        DelayBlockConfiguration* blockConfiguration;
        uint64_t timestamp = 0;

    public:
        DelayBlock(DelayBlockConfiguration* blockConfiguration);
        ~DelayBlock();

        block_err_t executeBlock() override;
        block_err_t enterBlock() override;

};

#endif