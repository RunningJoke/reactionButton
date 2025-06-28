#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "BlockManager/BlockManager.h"
#include "BLEManager/BLEManager.h"
#include "BlockConfigs.h"


#include "esp_task_wdt.h"



uint64_t timestamp = 0;
BLEMode bootMode = BLEMode::PERIPHERAL;

void setup() {
  initArduino();
  Serial.begin(115200);
  SPIFFS.begin(true);
  

  pinMode(PIN_BUTTON_PRESS , INPUT);

  pinMode(PIN_BATTERY_LEVEL , INPUT);

  randomSeed(analogRead(0));


  Serial.println("Starting ReactPod Bootup...");

  if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
    bootMode = BLEMode::CENTRAL;
    //a button press during bootup makes the system boot in central mode
    BLEManager::getManager()->bootMode(BLEMode::CENTRAL);
  } else {
    bootMode = BLEMode::PERIPHERAL;
    //no button press during bootup makes the system boot in peripheral mode
    BLEManager::getManager()->bootMode(BLEMode::PERIPHERAL);

    
  }

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

  if(bootMode == BLEMode::PERIPHERAL) {
      BLEManager::getManager()->runAsPeripheral();
  } else {
      BLEManager::getManager()->runAsCentral();
    //BlockManager* blockManager = BlockManager::getManager();
    //ESP_LOGD("MAIN", "Running blocks...");
    //blockManager->runBlocks();

  }

  
  
}
