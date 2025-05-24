#include "ButtonBlock.h"

ButtonBlock::ButtonBlock(ButtonBlockConfiguration* blockConfiguration) {
    this->genericBlockConfiguration = blockConfiguration;
    this->blockConfiguration = blockConfiguration;
    this->blockConfiguration->parentBlock = this; // Set the parent block reference
}

ButtonBlock::~ButtonBlock() {
    // Destructor implementation
}

block_err_t ButtonBlock::executeBlock() {
    uint8_t buttonState = digitalRead(PIN_BUTTON_PRESS);
    if(buttonState == LOW) { // Assuming LOW means pressed
            this->wasPressed = true;
    } 
    return 0;
}

bool ButtonBlock::wasTriggered() {
    return this->wasPressed;
}

void ButtonBlock::reset() {
    this->wasPressed = false;
}