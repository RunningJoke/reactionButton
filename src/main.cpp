#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "PodModes/ParentPod/ParentPod.h"
#include "PodModes/ChildPod/ChildPod.h"

#include "Modes/ReactionMode/ReactionMode.h"

#include "BLEDataField/BLEColorDataField.h"
#include "BLEDataField/BLELongDataField.h"
#include <BLEDevice.h>

#include "esp_task_wdt.h"

uint64_t startTime = 0;
uint64_t waitTime = 0;
uint64_t reactionTimerStart = 0;
uint64_t reactionTimerEnd = 0;

uint8_t currentModeState = 0;

LEDManager* ledManager = nullptr;

VMode* currentMode = nullptr;
ReactionMode* reactionMode = nullptr;

BLELongDataField *pStopWatchField = nullptr;
BLELongDataField *pModeField = nullptr;

VPod* currentPodMode = nullptr;

uint8_t mainStateSwitch = 0;

void setup() {
  Serial.begin(9600);

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  ledManager = new LEDManager(19);


  currentPodMode = new ChildPod(ledManager);

  ledManager->turnOff();

  randomSeed(analogRead(0));


  

    

  currentPodMode->start();

}

void loop() {

  uint64_t timestamp = millis();

  switch(mainStateSwitch) {
    case 0: 
      if(currentPodMode->update(timestamp) == 2) {
        //no parent found, become the parent
        mainStateSwitch = 1; 
      }
      break;
    case 1: 
      currentPodMode->stop();
      currentPodMode = new ParentPod(ledManager);
      currentPodMode->start();
      mainStateSwitch = 2;
      break;
    case 2:
      currentPodMode->update(timestamp);
      break;
  }

  vTaskDelay(1/portTICK_PERIOD_MS);
  esp_task_wdt_reset();
  

 

  




}
