#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "BlockManager/BlockManager.h"
#include "BlockConfigs.h"

#include <BLEDevice.h>

#include "esp_task_wdt.h"



void setup() {
  initArduino();

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT);

  randomSeed(analogRead(0));

  ESP_LOGI("MAIN", "Starting up...");

  BlockManager* blockManager = BlockManager::getManager();
  blockManager->assignBlock(DelayBlock1000ms);
  blockManager->assignBlock(LEDRed);
  blockManager->assignBlock(ButtonBlock);
  blockManager->assignBlock(LEDGreen);
  blockManager->defineStartBlock("Delay 1000ms");


}

void loop() {

  BlockManager* blockManager = BlockManager::getManager();
  ESP_LOGD("MAIN", "Running blocks...");
  blockManager->runBlocks();

}
