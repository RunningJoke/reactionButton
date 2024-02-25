#include <Arduino.h>
#include "_Definitions.h"
#include "BluetoothManager/BluetoothManager.h"

#include "BLEDataField/BLEColorDataField.h"
#include "BLEDataField/BLELongDataField.h"
#include <BLECharacteristic.h>

uint64_t startTime = 0;
uint64_t waitTime = 0;
uint64_t reactionTimerStart = 0;
uint64_t reactionTimerEnd = 0;

uint8_t state = 0;

BluetoothManager* bleManager = nullptr;

BLELongDataField *pStopWatchField = nullptr;



void setup() {
  Serial.begin(9600);
  pinMode(PIN_LED_RED , OUTPUT);
  pinMode(PIN_LED_BLUE , OUTPUT);
  pinMode(PIN_LED_GREEN , OUTPUT);

  pinMode(PIN_BUTTON_PRESS , INPUT_PULLUP);

  bleManager = new BluetoothManager();

  randomSeed(analogRead(0));

  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_LED_BLUE, HIGH);
  digitalWrite(PIN_LED_GREEN, HIGH);

bleManager->createCharacteristic(
    BLE_NAME_STOPWATCH_ID , 
    BLE_REACTION_TIME_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY);

pStopWatchField = bleManager->getLongDataField(BLE_NAME_STOPWATCH_ID);


bleManager->startBLEService();


   

}

void loop() {
  
  switch(state) {
    case 0:
      Serial.println("Start measurement");
      startTime = millis();
      waitTime = random(500 , 2500);
      digitalWrite(PIN_LED_RED, HIGH);
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_BLUE, LOW);
      state = 1;
      break;
    case 1:
      if(waitTime + startTime <= millis()) {
        reactionTimerStart = millis();
        digitalWrite(PIN_LED_RED, HIGH);
        digitalWrite(PIN_LED_GREEN, LOW);
        digitalWrite(PIN_LED_BLUE, HIGH);
        state = 2;
      }
      if(digitalRead(PIN_BUTTON_PRESS) == HIGH) {        
        digitalWrite(PIN_LED_RED, LOW);
        digitalWrite(PIN_LED_GREEN, HIGH);
        digitalWrite(PIN_LED_BLUE, HIGH);
        state = 4;
      }
      break;
    case 2:
      if(digitalRead(PIN_BUTTON_PRESS) == HIGH) {
        reactionTimerEnd = millis();
        digitalWrite(PIN_LED_RED, LOW);
        digitalWrite(PIN_LED_GREEN, LOW);
        digitalWrite(PIN_LED_BLUE, LOW);
        state = 3;
      }
      break;
    case 3: {
      pStopWatchField->setValue((reactionTimerEnd - reactionTimerStart));
      Serial.println((reactionTimerEnd - reactionTimerStart));
      delay(1000);      
      digitalWrite(PIN_LED_RED, HIGH);
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_BLUE, HIGH);
      delay(4000);
      state = 0;
      break;
    }
    case 4: {
      pStopWatchField->setValue((reactionTimerEnd - reactionTimerStart));
      Serial.println("FALSE START");
      delay(300);      
      digitalWrite(PIN_LED_RED, HIGH);
      delay(300);      
      digitalWrite(PIN_LED_RED, LOW);
      delay(300);      
      digitalWrite(PIN_LED_RED, HIGH);
      delay(300);   
      digitalWrite(PIN_LED_RED, LOW);
      delay(300); 
      digitalWrite(PIN_LED_RED, HIGH);
      delay(3500);
      state = 0;
      break;
    }

  }
  




}
