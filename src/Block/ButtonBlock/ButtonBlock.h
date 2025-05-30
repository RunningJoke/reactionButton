#ifndef BUTTONBLOCK_H
#define BUTTONBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "Block/IBlockConfiguration.h"
#include "ColorSet/ColorSet.h"
#include "_Definitions.h"

class ButtonBlockConfiguration;

enum class ButtonState {
    NO_PRESS,
    PRESSED,
    SHORT_PRESS,
    LONG_PRESS,
    TIMEOUT
};

class ButtonBlock : public VBlock {

    protected:
    ButtonBlockConfiguration* blockConfiguration;
    ButtonState currentState = ButtonState::NO_PRESS;
    uint64_t timestamp = 0;

public:
    ButtonBlock(ButtonBlockConfiguration* blockConfiguration);
    ~ButtonBlock();

    block_err_t executeBlock() override;
    ButtonState getState();
    void reset();
    block_err_t enterBlock() override;
};

struct ButtonBlockParameter {
    uint64_t shortPressLimit;
    uint64_t longPressMinimum;
    uint64_t timeout;
} ;

extern ButtonBlockParameter DEFAULT_BUTTON_PARAMETERS;

struct ButtonBlockConfiguration : public IBlockConfiguration {  

    ButtonBlock* parentBlock;
    const char* nextBlockNameShortPress = nullptr;
    const char* nextBlockNameLongPress = nullptr;
    const char* nextBlockNamePressed = nullptr;
    const char* nextBlockNameTimeout = nullptr;

    ButtonBlockParameter* parameters = &DEFAULT_BUTTON_PARAMETERS;

    ButtonBlockConfiguration(
            const char* blockName, 
            const char* nextBlockNameAnyPress , 
            const char* nextBlockNameShortPress = nullptr, 
            const char* nextBlockNameLongPress = nullptr, 
            const char* nextBlockNamePressed = nullptr,
            const char* nextBlockNameTimeout = nullptr,
            ButtonBlockParameter* parameters = nullptr    
        )
    
        : IBlockConfiguration(blockName, BlockType::WAIT_FOR_PRESS, nextBlockNameAnyPress) {
        
            this->nextBlockNamePressed = nextBlockNamePressed;
            this->nextBlockNameShortPress = nextBlockNameShortPress;
            this->nextBlockNameLongPress = nextBlockNameLongPress;
            this->nextBlockNameTimeout = nextBlockNameTimeout;

            if(parameters == nullptr) {
                this->parameters = &DEFAULT_BUTTON_PARAMETERS;
            } else {
                this->parameters = parameters;
            }
        
        }

    const char* getNextBlockName() override {
        switch(this->parentBlock->getState()) {
            case ButtonState::NO_PRESS:
                return this->blockName;
                break;
            case ButtonState::SHORT_PRESS:
                if(this->nextBlockNameShortPress != nullptr) {
                    this->parentBlock->reset();
                    return this->nextBlockNameShortPress;
                }
                break;
            case ButtonState::LONG_PRESS:
                if(this->nextBlockNameLongPress != nullptr) {
                    this->parentBlock->reset();
                    return this->nextBlockNameLongPress;
                }
                break;
            case ButtonState::PRESSED:
                if(this->nextBlockNamePressed != nullptr) {
                    return this->nextBlockNamePressed;
                }
                break;
            case ButtonState::TIMEOUT:
                if(this->nextBlockNameTimeout != nullptr) {
                    this->parentBlock->reset();
                    return this->nextBlockNameTimeout;
                }
                break;
        }

        //check if button was pressed and run the generic handle
        if(this->nextBlockName != nullptr && (this->parentBlock->getState() == ButtonState::LONG_PRESS || this->parentBlock->getState() == ButtonState::SHORT_PRESS)) {
            return this->nextBlockName;
        }

        //if no item was triggered, fallback to repeat the block
        return this->blockName;
    }
};

#endif