#include <Arduino.h>
#include "Config/Console.h"
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/BootupAnimation.h"
#include "Roles/RoleManager.h"
#include "Store/ProgramStore.h"
#include "Settings/Settings.h"
#include "Diagnostics/Diag.h"

uint64_t timestamp = 0;


void setup() {
  initArduino();
  Diag::begin();
  consoleBegin();
  SPIFFS.begin(true);
  ProgramStore::get().begin();


  pinMode(PIN_BUTTON_PRESS , INPUT);

  pinMode(PIN_BATTERY_LEVEL , INPUT);

  randomSeed(analogRead(0));


  Console.printf("Starting ReactPod Bootup (firmware %d.%d)...\n", FW_VERSION_MAJOR, FW_VERSION_MINOR);



  LEDManager::getManager()->turnOff();

  timestamp = millis();
  while(millis() - timestamp < 2000) {
    LEDManager::getManager()->setLEDColors(&bootupPattern);
    delay(10);
  }

 LEDManager::getManager()->turnOff();

  // a role requested via the "reboot" command wins (used once), otherwise the button decides
  uint8_t bootRole = Settings::takeBootRole();
  bool central = bootRole == 1 || (bootRole == 0 && digitalRead(PIN_BUTTON_PRESS) == LOW);

  if(central) {
    //a button press during bootup makes the system boot in central mode
    RoleManager::getManager()->boot(Role::CENTRAL);
  } else {
    //no button press during bootup makes the system boot in peripheral mode
    RoleManager::getManager()->boot(Role::PERIPHERAL);
  }


  timestamp = millis();


}

void loop() {

  RoleManager::getManager()->run();


}
