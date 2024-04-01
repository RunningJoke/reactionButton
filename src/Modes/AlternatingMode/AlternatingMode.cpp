#include "AlternatingMode.h"


AlternatingMode::AlternatingMode(LEDManager* ledManager, uint8_t numberOfSets)
{
    this->ledManager = ledManager;
    this->numberOfSets = numberOfSets;
    this->setCounter = 0;

}

void AlternatingMode::run(uint64_t timestamp) 
{
    switch(this->internalState)
    {
        case 0: //disable all remote pods

            this->internalState = 1;
            break;
        case 1: //start by lighting up managing pod
            NodeManager::getNode(0)->activate(1);
            this->internalState = 2;
            break;
        case 2:
            if(NodeManager::getNode(0)->isPressed()) {
                //activate the other node
                Serial.println("activate remote pad");

                NodeManager::getNode(1)->activate(1);
                this->internalState = 3;
            }
            break;
        case 3:
            if(NodeManager::getNode(1)->isPressed()) {
                this->internalState = 1;
                this->setCounter++;
                Serial.println("start next set");
                if(this->setCounter >= this->numberOfSets) {
                    //goto reward state and reset
                    this->internalState = 4;
                } else {
                    //run again
                    this->internalState = 0;
                }
            }
            break;
        case 4:
            this->blink(LEDManager::BLUE, 3);
            this->reset();
            break;
    }
}

void AlternatingMode::reset()
{
    this->setCounter = 0;
    this->internalState = 0;


}