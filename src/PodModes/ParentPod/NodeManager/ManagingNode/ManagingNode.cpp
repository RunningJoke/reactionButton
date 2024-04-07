#include "ManagingNode.h"

ManagingNode::ManagingNode(LEDManager* ledManager)
{
    this->ledManager = ledManager;
}

void ManagingNode::pressed(uint64_t timestamp)
{
    this->lastTimePressed = timestamp;
    //disable LED
    this->ledManager->turnOff();
    this->wasPressed = true;
}

void ManagingNode::activate(const char* colorId)
{
    this->wasPressed = false;
    
    uint64_t activationValue = atoll(colorId);            
    switch(activationValue) {
        case 0x00: //do nothing. No signal sent/signal was reset
            break;
        case 254L: //cycle complete signal. Blink blue 3 times
            Serial.println("Blink");
            this->blink(LEDManager::BLUE, 3);
            break;
        case 255L: //deactivation signal
            Serial.println("Deactivate");
            this->ledManager->turnOff();
            break;
        default:   
            this->ledManager->setLEDColors((uint8_t)activationValue);
            this->lastTimePressed = millis();
            break;
    }
}



void ManagingNode::deactivate() {
    this->ledManager->turnOff();
}

bool ManagingNode::isPressed()
{
    return this->wasPressed;
}


void ManagingNode::blink(ColorSet* color, uint8_t repetitions)
{
    uint8_t i = 0;
    for(i = 0; i < repetitions ; i++) {
        this->ledManager->setLEDColors(color);
        delay(300);      
        this->ledManager->turnOff();
        delay(300); 
    }
}