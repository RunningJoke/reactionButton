#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"

#include <BLEDevice.h>

#include "esp_task_wdt.h"

LEDManager* ledManager = nullptr;

void setup() {
  Serial.begin(9600);

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  ledManager = new LEDManager(19);

  ledManager->turnOff();

  randomSeed(analogRead(0));

}

void loop() {

  uint64_t timestamp = millis();


  vTaskDelay(1/portTICK_PERIOD_MS);
  esp_task_wdt_reset();
  

}
