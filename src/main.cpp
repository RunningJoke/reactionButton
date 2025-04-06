#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "PodModes/ParentPod/ParentPod.h"
#include "Modes/ReactionMode/ReactionMode.h"


#include "esp_task_wdt.h"

uint64_t startTime = 0;
uint64_t waitTime = 0;
uint64_t reactionTimerStart = 0;
uint64_t reactionTimerEnd = 0;

uint8_t currentModeState = 0;

LEDManager* ledManager = nullptr;

VMode* currentMode = nullptr;
ReactionMode* reactionMode = nullptr;


VPod* currentPodMode = nullptr;

uint8_t mainStateSwitch = 0;

void setup() {
  Serial.begin(9600);

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT);

  ledManager = new LEDManager(7);


  currentPodMode = new ParentPod(ledManager);


  ledManager->turnOff();

  randomSeed(analogRead(0));

  currentPodMode->start();

}

void loop() {

    uint64_t timestamp = millis();
    currentPodMode->update(timestamp);

    vTaskDelay(1/portTICK_PERIOD_MS);
    esp_task_wdt_reset();

}
