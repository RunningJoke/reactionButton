#include "ReactionMode.h"

ReactionMode::ReactionMode(LEDManager* ledManager)
{
    this->ledManager = ledManager;
}

void ReactionMode::run(uint64_t timestamp)
{
    switch(this->internalState) {
    case 0:
      Serial.println("Start measurement");
      this->internalTimerStart = timestamp;
      this->reactionTimerDelay = random(500 , 2500);
      ledManager->setLEDColors(LEDManager::BLUE);
      this->internalState = 1;
      break;
    case 1:
      if(this->reactionTimerDelay + this->internalTimerStart <= timestamp) {
        this->reactionTimerStart = timestamp;
        ledManager->setLEDColors(LEDManager::GREEN);

        this->internalState = 2;
      }
      if(digitalRead(PIN_BUTTON_PRESS) == LOW) {        
        ledManager->setLEDColors(LEDManager::RED);
        this->internalState = 4;
      }
      break;
    case 2:
      if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
        this->reactionTimerStop = timestamp;
        ledManager->turnOff();
        this->internalState = 3;
      }
      break;
    case 3: {
      Serial.println((reactionTimerStop - reactionTimerStart));
      ledManager->turnOff();
      delay(300);      
      this->blink(LEDManager::GREEN , 2);
      delay(4000);
      this->internalState = 0;
      break;
    }
    case 4: {
      Serial.println("FALSE START");
      this->blink(LEDManager::RED , 3);
      delay(3500);
      this->internalState = 0;
      break;
    }

  }
}


void ReactionMode::reset()
{
    this->internalState = 0;
    ledManager->turnOff();
}