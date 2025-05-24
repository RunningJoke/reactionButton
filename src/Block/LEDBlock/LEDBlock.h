#ifndef LEDBLOCK_H
#define LEDBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"

struct LEDBlockConfiguration : public IBlockConfiguration {
    ColorSet color;    

    BlockType getBlockType() override {
        return BlockType::LED;
    }

};


class LEDBlock : public VBlock {

    protected:
    LEDBlockConfiguration* blockConfiguration;


public:
    LEDBlock(IBlockConfiguration* blockConfiguration);
    ~LEDBlock();

    block_err_t executeBlock() override;
    String getBlockName() override;
    IBlockConfiguration * getBlockConfiguration() override;

};

#endif