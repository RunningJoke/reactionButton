#include "ParentPod.h"


ParentPod::ParentPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
    this->currentStatus = 0;
}


int8_t ParentPod::update(uint64_t timestamp)
{


    

    switch(this->currentStatus)
    {
        case 0: //config mode, register new children and wait
        {
            if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                //button pressed, switch to actual active mode
                this->currentStatus = 1;
            }
            break;
        }
        case 1:
        {
            this->activeMode = new ReactionMode(this->ledManager);
            this->currentStatus = 2;
            break;        
        }
        case 2:
            this->activeMode->run(timestamp);
            break;
    }

    
    
    return 0;
}


void ParentPod::start()
{
    this->ledManager->setLEDColors(this->ledManager->MAGENTA);
    

}

void ParentPod::stop()
{

}



