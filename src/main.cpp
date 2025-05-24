#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "BlockManager/BlockManager.h"
#include "BlockConfigs.h"

#include <BLEDevice.h>

#include "esp_task_wdt.h"



void setup() {
  Serial.begin(9600);

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  randomSeed(analogRead(0));

  BlockManager* blockManager = BlockManager::getManager();
  blockManager->assignBlock(DelayBlock1000ms);
  blockManager->assignBlock(LEDRed);
  blockManager->assignBlock(DelayBlock1000ms_2);
  blockManager->assignBlock(LEDGreen);
  blockManager->defineStartBlock("Delay 1000ms");


}

void loop() {

  BlockManager* blockManager = BlockManager::getManager();
  blockManager->runBlocks();


  vTaskDelay(1/portTICK_PERIOD_MS);
  esp_task_wdt_reset();
  

}
