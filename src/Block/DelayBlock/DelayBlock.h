#ifndef DELAYBLOCK_H
#define DELAYBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"

struct DelayBlockConfiguration : public IBlockConfiguration {
    uint64_t delay; // Delay in milliseconds

    DelayBlockConfiguration(const char* blockName, const char* nextBlockName, uint64_t delayTime)
        : IBlockConfiguration(blockName, BlockType::DELAY, nextBlockName) {
            this->delay = delayTime;
        }
};

class DelayBlock : public VBlock {

    protected:
        DelayBlockConfiguration* blockConfiguration;


    public:
        DelayBlock(DelayBlockConfiguration* blockConfiguration);
        ~DelayBlock();

        block_err_t executeBlock() override;

};

#endif