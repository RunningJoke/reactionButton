#ifndef DELAYBLOCK_H
#define DELAYBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"

struct DelayBlockConfiguration : public IBlockConfiguration {
    uint64_t delay;    

    BlockType getBlockType() override {
        return BlockType::DELAY;
    }

};


class DelayBlock : public VBlock {

    protected:
    DelayBlockConfiguration* blockConfiguration;


public:
    DelayBlock(IBlockConfiguration* blockConfiguration);
    ~DelayBlock();

    block_err_t executeBlock() override;
    String getBlockName() override;
    IBlockConfiguration * getBlockConfiguration() override;

};

#endif