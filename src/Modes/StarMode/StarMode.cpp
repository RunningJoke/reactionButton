#include "StarMode.h"


StarMode::StarMode(LEDManager* ledManager, uint8_t nodeCount, uint8_t numberOfPresses)
{
    this->ledManager = ledManager;
    this->numberOfPresses = numberOfPresses;
    this->setCounter = 0;
    this->nodeCount = nodeCount;

    this->currentPodId = random(1,this->nodeCount);

}

void StarMode::run(uint64_t timestamp) 
{
    switch(this->internalState)
    {
        case 0: //disable all remote pods
            NodeManager::deactivateAllNodes();
            this->internalState = 1;
            this->blink(LEDManager::WHITE, 3);
            delay(1000);
            break;
        case 1: //light up remote pod
            {
                auto newPodId = random(1,this->nodeCount);
                while(newPodId == this->currentPodId) {
                    newPodId = random(1,this->nodeCount);
                }
                Serial.print("activatingPod ");
                Serial.println(newPodId);
                this->currentPodId = newPodId;
                NodeManager::getNode(this->currentPodId)->activate("1");
                this->internalState = 2;
                break;
            }
            
        case 2:
            //wait for remote button to be pressed
            if(NodeManager::getNode(this->currentPodId)->isPressed()) {
                //activate managing node
                NodeManager::getNode(0)->activate("1");
                this->internalState = 3;
            }
            break;
        case 3:
            //wait for managing node to be pressed
            if(NodeManager::getNode(0)->isPressed()) {
                this->internalState = 1;
                
                //one set completed
                this->setCounter++;
                
                if(this->setCounter > this->numberOfPresses) {
                    //go to exit state
                    this->internalState = 4;
                }
            }
            break;
        case 4:

            NodeManager::activateAllNodes("254");
            delay(3000);
            this->reset();
            this->internalState = 0;
            break;
    }
}

void StarMode::reset()
{
    this->setCounter = 0;
    this->internalState = 0;
    this->currentPodId = random(0,this->nodeCount);


}