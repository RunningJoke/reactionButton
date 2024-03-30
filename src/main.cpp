#include <Arduino.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "BluetoothManager/BluetoothManager.h"
#include "LEDManager/LEDManager.h"
#include "CommunicationManager/ParentPod/ParentPod.h"
#include "CommunicationManager/ChildPod/ChildPod.h"

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

ParentPod* parentPod = nullptr;
ChildPod* childPod = nullptr;

uint8_t mainStateSwitch = 0;

void setup() {
  Serial.begin(9600);

  SPIFFS.begin(false);
  

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  bleManager = new BluetoothManager();
  ledManager = new LEDManager(19);


  childPod = new ChildPod(ledManager);
  parentPod = new ParentPod(ledManager);

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
WiFi.mode(WIFI_AP);

if(esp_now_init() == ESP_OK) {
  Serial.println("ESP Now initialized");


  esp_now_peer_info_t peerInfo_podA;
  esp_now_peer_info_t peerInfo_podB;

  uint8_t macPodA[] = {0x08,0xF9,0xE0,0xD4,0x0C,0xC8};
  uint8_t macPodB[] = {0x08,0xF9,0xE0,0xD4,0x13,0x04};

  memcpy(peerInfo_podA.peer_addr, macPodA, 6);
  peerInfo_podA.channel = 0;  
  peerInfo_podA.encrypt = false;
  peerInfo_podA.ifidx=WIFI_IF_AP;

  memcpy(peerInfo_podB.peer_addr, macPodB, 6);
  peerInfo_podB.channel = 0;  
  peerInfo_podB.encrypt = false;
  peerInfo_podB.ifidx=WIFI_IF_AP;

  if (esp_now_add_peer(&peerInfo_podA) == ESP_OK){
    Serial.println("Added Pod A");
  }
  if (esp_now_add_peer(&peerInfo_podB) == ESP_OK){
    Serial.println("Added Pod B");
  }
}

//Serial.println(WiFi.macAddress());


childPod->start();

}

void loop() {

  uint64_t timestamp = millis();


  switch(mainStateSwitch) {
    case 0: 
      if(childPod->update(timestamp) == 2) {
        //no parent found, become the parent
        mainStateSwitch = 1; 
      }
      break;
    case 1: 
      childPod->stop();
      parentPod->start();
      mainStateSwitch = 2;
      break;
    case 2:
      parentPod->update(timestamp);
      break;
  }
  

/*
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

*/
  //parentPod->update(timestamp);
 // currentMode->run(timestamp);

 

  




}
