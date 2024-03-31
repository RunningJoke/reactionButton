#include "ReactionMode.h"

ReactionMode::ReactionMode(LEDManager* ledManager, BLELongDataField* stopwatchField)
{
    this->ledManager = ledManager;
    this->stopwatchField = stopwatchField;
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
      this->stopwatchField->setValue((reactionTimerStop - reactionTimerStart));
      Serial.println((reactionTimerStop - reactionTimerStart));
      ledManager->turnOff();
      delay(300);      
      this->blink(LEDManager::GREEN , 2);
      delay(4000);
      this->internalState = 0;
      break;
    }
    case 4: {
      this->stopwatchField->setValue(0);
      Serial.println("FALSE START");
      this->blink(LEDManager::RED , 3);
      delay(3500);
      this->internalState = 0;
      break;
    }

  }
}

void ReactionMode::blink(ColorSet* color, uint8_t repetitions)
{
    uint8_t i = 0;
    for(i = 0; i < repetitions ; i++) {
        ledManager->setLEDColors(color);
        delay(300);      
        ledManager->turnOff();
        delay(300); 
    }
}

void ReactionMode::reset()
{
    this->internalState = 0;
    ledManager->turnOff();
}