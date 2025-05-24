#ifndef BUTTONBLOCK_H
#define BUTTONBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"
#include "_Definitions.h"

class ButtonBlockConfiguration;


class ButtonBlock : public VBlock {

    protected:
    ButtonBlockConfiguration* blockConfiguration;
    bool wasPressed = false;

public:
    ButtonBlock(ButtonBlockConfiguration* blockConfiguration);
    ~ButtonBlock();

    block_err_t executeBlock() override;
    bool wasTriggered();
    void reset();
};


struct ButtonBlockConfiguration : public IBlockConfiguration {  

    ButtonBlock* parentBlock;
    ButtonBlockConfiguration(const char* blockName, const char* nextBlockName)
        : IBlockConfiguration(blockName, BlockType::WAIT_FOR_PRESS, nextBlockName) {
        }

    const char* getNextBlockName() override {
        if(this->parentBlock->wasTriggered()) {
            this->parentBlock->reset();
            return this->nextBlockName;
        } else {
            ESP_LOGD("BUTTONBLOCK", "Button not pressed, returning current block name");
            return this->blockName;
        }
    }
};

#endif