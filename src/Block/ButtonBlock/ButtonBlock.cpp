#include "ButtonBlock.h"

ButtonBlockParameter DEFAULT_BUTTON_PARAMETERS = ButtonBlockParameter{
    .shortPressLimit = 1000UL,
    .longPressMinimum = 2000UL,
    .minTimeout = 0,
    .maxTimeout = 0,
    .randomizeTimeout = false
};

ButtonBlock::ButtonBlock(ButtonBlockConfiguration* blockConfiguration) {
    this->genericBlockConfiguration = blockConfiguration;
    this->blockConfiguration = blockConfiguration;
    this->blockConfiguration->parentBlock = this; // Set the parent block reference
    this->currentState = ButtonState::NO_PRESS;
    this->timestamp = 0;
}

ButtonBlock::~ButtonBlock() {
    // Destructor implementation
}

block_err_t ButtonBlock::enterBlock() {
    this->reset();

    //check if timeout is specified
    if(this->blockConfiguration->nextBlockNameTimeout != nullptr) {        
        //check if timeout is randomized. If so, calcualte it here
        if(this->blockConfiguration->parameters->randomizeTimeout == true)
        {
            this->timeout = (uint64_t)random(this->blockConfiguration->parameters->minTimeout , this->blockConfiguration->parameters->maxTimeout);
        } else {
            this->timeout = this->blockConfiguration->parameters->minTimeout;
        }
    }


    return 0;
}

block_err_t ButtonBlock::executeBlock() {
    uint8_t buttonState = digitalRead(PIN_BUTTON_PRESS);
    uint64_t currentTimestamp = millis();

    if(buttonState == LOW && this->currentState == ButtonState::NO_PRESS) { // Assuming LOW means pressed
        ESP_LOGI("BUTTONBLOCK", "Button pressed");    
        this->currentState = ButtonState::PRESSED;
        this->timestamp = currentTimestamp;
    } 


    if(buttonState == HIGH && this->currentState == ButtonState::PRESSED) {
        //button was released. Check if it was a short press or a long press
        if(this->timestamp + this->blockConfiguration->parameters->shortPressLimit >= currentTimestamp) {
            ESP_LOGI("BUTTONBLOCK", "Short press detected");
            this->currentState = ButtonState::SHORT_PRESS;
        } else if(this->timestamp + this->blockConfiguration->parameters->longPressMinimum <= currentTimestamp) {
            ESP_LOGI("BUTTONBLOCK", "Long press detected");
            this->currentState = ButtonState::LONG_PRESS;
        }
    }

    if(this->blockConfiguration->nextBlockNameTimeout != nullptr && buttonState == HIGH && (this->timestamp + this->timeout < currentTimestamp)){
            ESP_LOGI("BUTTONBLOCK", "Timeout detected");
            this->currentState = ButtonState::TIMEOUT;
        }

    return 0;
}

ButtonState ButtonBlock::getState() {
    return this->currentState;
}

void ButtonBlock::reset() {
    this->currentState = ButtonState::NO_PRESS;
    this->timestamp = millis();
}