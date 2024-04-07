#include "RandomMode.h"


RandomMode::RandomMode(LEDManager* ledManager, uint8_t nodeCount, uint8_t numberOfPresses)
{
    this->ledManager = ledManager;
    this->numberOfPresses = numberOfPresses;
    this->setCounter = 0;
    this->nodeCount = nodeCount;

    this->currentPodId = random(0,this->nodeCount);

}

void RandomMode::run(uint64_t timestamp) 
{
    switch(this->internalState)
    {
        case 0: //disable all remote pods
            NodeManager::deactivateAllNodes();
            this->internalState = 1;
            this->blink(LEDManager::WHITE, 3);
            delay(1000);
            break;
        case 1: //start by lighting up random pod
            {
                auto newPodId = random(0,this->nodeCount);
                while(newPodId == this->currentPodId) {
                    newPodId = random(0,this->nodeCount);
                }
                Serial.print("activatingPod ");
                Serial.println(newPodId);
                this->currentPodId = newPodId;
                NodeManager::getNode(this->currentPodId)->activate("1");
                this->internalState = 2;
                break;
            }
            
        case 2:
            if(NodeManager::getNode(this->currentPodId)->isPressed()) {
                this->internalState = 1;
                this->setCounter++;

                if(this->setCounter > this->numberOfPresses) {
                    //go to exit state
                    this->internalState = 3;
                }
            }
            break;
        case 3:
            NodeManager::activateAllNodes("254");
            delay(3000);
            this->reset();
            this->internalState = 0;
            break;
    }
}

void RandomMode::reset()
{
    this->setCounter = 0;
    this->internalState = 0;
    this->currentPodId = random(0,this->nodeCount);


}