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

// Boot gauge (#19): the ring filled to the charge. Green above 50 %, amber 20-50 %, red below 20 %.
// Without a reading (0 mV) the ring is full in blue.
static Protocol::EffectDesc batteryGauge() {
  Protocol::EffectDesc gauge = {Protocol::EffectId::LEVEL, Protocol::Color::BLUE, Protocol::Color::OFF, 255, 0, 0, 100, 0};
  if(Battery::known()) {
    uint8_t percent = Battery::percent();
    gauge.color = percent > 50 ? Protocol::Color::GREEN : percent >= 20 ? Protocol::Color::AMBER : Protocol::Color::RED;
    gauge.param = percent;
  }
  return gauge;
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
  LEDManager::getManager()->playEffect(batteryGauge());

  timestamp = millis();
  while(millis() - timestamp < 2000) {
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
