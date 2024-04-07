#include "ChildPod.h"

ChildPod::ChildPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
    this->currentStatus = 0;
    this->discoveryTries = 0;
    this->lastDiscoveryTry = 0;


    //configure BLE for childpod here

    BLEDevice::init("Homeless Reaction Pod");
    this->pServer = BLEDevice::createServer();
    this->pService = pServer->createService(BLEUUID(BLE_REACTION_POD_ID) );

    this->createCharacteristic(
    BLE_NAME_STOPWATCH_ID , 
    BLE_REACTION_TIME_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY);

    this->createCharacteristic(
    BLE_NAME_MODE_ID , 
    BLE_MODE_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE);
    
    this->createCharacteristic(
    BLE_NAME_ACTIVATE_ID , 
    BLE_ACTIVATION_UID , 
    BLE_FIELDTYPE_LONG , 
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE);


    this->pModeField = this->getLongDataField(BLE_NAME_MODE_ID);
    this->pStopwatchField = this->getLongDataField(BLE_NAME_STOPWATCH_ID);
    this->pActivationField = this->getLongDataField(BLE_NAME_ACTIVATE_ID);

}

int8_t ChildPod::update(uint64_t timestamp)
{
    switch(this->currentStatus) {
        case 0: //discoveryMode - check if a parent exists
            {
            if(lastDiscoveryTry + 1000UL <= timestamp) {
                Serial.println("Looking for Marco");
                const uint8_t data[] = "MARCO";
                

                //send again
                
                if(this->pModeField->getValue() != 0) {
                    
                    //Pod was claimed, switch to childMode
                    this->currentStatus = 2;

                    this->ledManager->setLEDColors(this->ledManager->YELLOW);
                    return 0;
                }

                lastDiscoveryTry = timestamp;

                //update LED ring
                this->ledManager->setLEDColors(this->discoveryTries , this->ledManager->BLUE);
                
                this->discoveryTries++;

                if(this->discoveryTries > 11) {
                    //switch to parent mode
                    Serial.println("I AM Marco");
                    this->currentStatus = 1;
                    return 2;
                }

                return 0;
            }
            break;
            }
        case 1: //no parent found, switch to parent mode
            return 2;

        case 2: //parent responded
            //run basic configuration based on parent data
            this->currentStatus = 3;
            return 0; //return status code 0 to stay in child mode
        case 3:
        {
            uint64_t activationValue = this->pActivationField->getValue();            
            switch(activationValue) {
                case 0x00: //do nothing. No signal sent/signal was reset
                    delay(0);
                    break;
                case 254L: //cycle complete signal. Blink blue 3 times
                    Serial.println("Blink");
                    this->blink(LEDManager::BLUE, 3);
                    this->pActivationField->setValue(0x00);
                    break;
                case 255L: //deactivation signal
                    Serial.println("Deactivate");
                    this->ledManager->turnOff();
                    this->pActivationField->setValue(0x00);
                    break;
                case 240L: //waiting for button press
                    if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                        Serial.println("Pressed");

                        this->pStopwatchField->setValue((timestamp - this->stopwatchTimer));
                        this->ledManager->turnOff();
                        this->pActivationField->setValue(0x00);
                    }
                    break;
                default:   
                    Serial.println(activationValue) ;
                    this->ledManager->setLEDColors((uint8_t)activationValue);
                    this->stopwatchTimer = timestamp;
                    this->pActivationField->setValue(0xF0);
                    break;
            }

            
            break;
        }
    }

    return this->currentStatus;
    
}


void ChildPod::start()
{
    //start advertising and wait for recognition
    this->pService->start();
    this->pAdvertising = BLEDevice::getAdvertising();
    this->pAdvertising->addServiceUUID(BLE_REACTION_POD_ID);
    this->pAdvertising->setScanResponse(true);
    this->pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    this->pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();


}

void ChildPod::stop()
{
    this->pService->stop();
    BLEDevice::deinit(false);
    delete this->fieldArray[BLE_NAME_MODE_ID];
    delete this->fieldArray[BLE_NAME_STOPWATCH_ID];
}


void ChildPod::blink(ColorSet* color, uint8_t repetitions)
{
    uint8_t i = 0;
    for(i = 0; i < repetitions ; i++) {
        this->ledManager->setLEDColors(color);
        delay(300);      
        this->ledManager->turnOff();
        delay(300); 
    }
}