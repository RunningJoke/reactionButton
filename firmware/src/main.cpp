#include <Arduino.h>
#include "Config/Console.h"
#include <SPIFFS.h>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "Battery/Battery.h"
#include "Roles/RoleManager.h"
#include "Store/ProgramStore.h"
#include "Settings/Settings.h"
#include "Diagnostics/Diag.h"
#include "Link/EspNowLink.h"

uint64_t timestamp = 0;

// Boot pattern (#82, SystemPattern::BOOT): the battery gauge fills the ring in cyan, amber below 20 %
// (full cyan without a reading), then a white timer fills the ring while the role is read. The button
// is read when the pattern has ended.
static SystemPattern::Args bootArgs() {
  SystemPattern::Args args;
  if(Battery::known()) {
    args.percent = Battery::percent();
  }
  return args;
}


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

  // measured before the LEDs light up: 18 lit LEDs pull the battery voltage down
  Battery::measure();
  LEDManager::getManager()->playPattern(SystemPattern::Id::BOOT, bootArgs());

  // the pattern is drawn by service() (RoleManager::run is not running yet)
  timestamp = millis();
  while(millis() - timestamp < SystemPattern::BOOT_MS) {
    LEDManager::getManager()->service();
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

  Battery::service();
  RoleManager* roles = RoleManager::getManager();
  roles->run();

  // Idle states (IRole::idle): nothing is due, so wait up to 1 ms for a radio frame instead of
  // spinning. Armed activations keep the fast loop (timing.md §1).
  if(roles->idle()) {
    EspNowLink::get().idleWait(1);
  }
}
