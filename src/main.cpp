#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "BlockManager/BlockManager.h"
#include "BlockConfigs.h"


#include "esp_task_wdt.h"

uint64_t timestamp = 0;


void setup() {
  initArduino();

  SPIFFS.begin(true);
  

  pinMode(PIN_BUTTON_PRESS , INPUT);

  pinMode(PIN_BATTERY_LEVEL , INPUT);

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

  
  bootUpAnimation->bitmask = bootUpPattern->ids;

  timestamp = millis();
}

void loop() {

  uint16_t batteryLevel = analogRead(PIN_BATTERY_LEVEL);
  ESP_LOGI("BOOTUP"," Battery status: %i", batteryLevel);
  
  while(timestamp + 5000UL > millis()) {
    //run the battery status script
    LEDManager::getManager()->setLEDColors(bootUpPattern);
  }
  
  BlockManager* blockManager = BlockManager::getManager();
  ESP_LOGD("MAIN", "Running blocks...");
  blockManager->runBlocks();

}
