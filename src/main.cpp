#include <Arduino.h>
#include "_Definitions.h"
#include "BluetoothManager/BluetoothManager.h"
#include "LEDManager/LEDManager.h"

#include "Modes/ReactionMode/ReactionMode.h"

#include "BLEDataField/BLEColorDataField.h"
#include "BLEDataField/BLELongDataField.h"
#include <BLECharacteristic.h>

uint64_t startTime = 0;
uint64_t waitTime = 0;
uint64_t reactionTimerStart = 0;
uint64_t reactionTimerEnd = 0;

uint8_t currentModeState = 0;

BluetoothManager* bleManager = nullptr;
LEDManager* ledManager = nullptr;

VMode* currentMode = nullptr;
ReactionMode* reactionMode = nullptr;

BLELongDataField *pStopWatchField = nullptr;
BLELongDataField *pModeField = nullptr;

void setup() {
  Serial.begin(9600);
  

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  bleManager = new BluetoothManager();
  ledManager = new LEDManager(13);

  ledManager->turnOff();

  randomSeed(analogRead(0));

  reactionMode = new ReactionMode(ledManager , bleManager);


  bleManager->createCharacteristic(
    BLE_NAME_STOPWATCH_ID , 
    BLE_REACTION_TIME_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY);

    
  bleManager->createCharacteristic(
    BLE_NAME_MODE_ID , 
    BLE_MODE_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE);

pStopWatchField = bleManager->getLongDataField(BLE_NAME_STOPWATCH_ID);
pModeField = bleManager->getLongDataField(BLE_NAME_MODE_ID);

bleManager->startBLEService();

}

void loop() {
  
  uint64_t timestamp = millis();


  pModeField->fetchValue();

  uint8_t newModeState = pModeField->getValue();
  bool stateSwitched = newModeState != currentModeState;
   
  if(stateSwitched) {
    currentMode->reset();
  }


  switch(newModeState) 
  {
    case MODE_REACTION:
      currentMode = reactionMode;
      break;
    default:
      ledManager->turnOff();
      break;
  }

  currentMode->run(timestamp);

 

  




}
