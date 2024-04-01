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

void ManagingNode::activate(uint8_t colorId)
{
    this->wasPressed = false;
    this->lastTimePressed = millis();
    this->ledManager->setLEDColors(colorId);
}

bool ManagingNode::isPressed()
{
    return this->wasPressed;
}