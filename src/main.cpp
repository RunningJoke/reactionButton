#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "BlockManager/BlockManager.h"
#include "BlockConfigs.h"


#include "esp_task_wdt.h"



void setup() {
  initArduino();

  SPIFFS.begin(true);
  

  pinMode(PIN_BUTTON_PRESS , INPUT);

  randomSeed(analogRead(0));


  ESP_LOGI("MAIN", "Starting up...");

  BlockManager* blockManager = BlockManager::getManager();
  blockManager->assignBlock(LEDBlue);
  blockManager->assignBlock(ButtonWaitBlock);
  blockManager->assignBlock(LEDRed);
  blockManager->assignBlock(LEDGreen);
  blockManager->assignBlock(ButtonBlock);
  blockManager->assignBlock(LEDCyan);
  blockManager->assignBlock(TimeToReset);
  blockManager->defineStartBlock("LEDBlue");


}

void loop() {

  BlockManager* blockManager = BlockManager::getManager();
  ESP_LOGD("MAIN", "Running blocks...");
  blockManager->runBlocks();

}
