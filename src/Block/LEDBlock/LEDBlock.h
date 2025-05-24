#ifndef LEDBLOCK_H
#define LEDBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"

struct LEDBlockConfiguration : public IBlockConfiguration {
    ColorSet* color;    

    LEDBlockConfiguration(const char* blockName, const char* nextBlockName, ColorSet* colorSet)
        : IBlockConfiguration(blockName, BlockType::LED, nextBlockName) {
            this->color = colorSet;
        }
};


class LEDBlock : public VBlock {

    protected:
    LEDBlockConfiguration* blockConfiguration;


public:
    LEDBlock(LEDBlockConfiguration* blockConfiguration);
    ~LEDBlock();

    block_err_t executeBlock() override;
};

#endif