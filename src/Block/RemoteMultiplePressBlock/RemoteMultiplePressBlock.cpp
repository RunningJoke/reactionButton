#include "RemoteMultiplePressBlock.h"
#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"


RemoteMultiplePressBlock::RemoteMultiplePressBlock(RemoteMultiplePressBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = blockConfiguration;
    this->genericBlockConfiguration = blockConfiguration; // Set the generic block configuration
    this->remainingCount = 0;
    this->localPressed = false;
    this->blockConfiguration->parentBlock = this; // Set the parent block reference
}

RemoteMultiplePressBlock::~RemoteMultiplePressBlock() {
    // Destructor implementation
}

block_err_t RemoteMultiplePressBlock::enterBlock() {
    this->reset();
    BLEManager* bleManager = BLEManager::getManager();
    VariableManager* variableManager = VariableManager::getManager();

    LEDManager* ledManager = LEDManager::getManager();

    this->remainingCount = (uint8_t)variableManager->getVariable(this->blockConfiguration->peripheralCountVariableName);
    uint8_t avoidCount = (uint8_t)variableManager->getVariable(this->blockConfiguration->avoidCountVariableName);
    
    //now randomly select the ids which should be avoided and the toggle correspondingly
    uint8_t selectedAvoids[avoidCount];
    for(uint8_t i = 0; i < avoidCount; i++) {
        bool unique = false;
        while(!unique) {
            unique = true;
            selectedAvoids[i] = random(0, this->remainingCount + 1); // Select a random peripheral ID
            for(uint8_t j = 0; j < i; j++) {
                if(selectedAvoids[i] == selectedAvoids[j]) {
                    unique = false; // Ensure uniqueness
                    break;
                }
            }
        }
    }

    //now set the action mode on the peripherals to either avoid or hit
    for(uint8_t i = 0; i < this->remainingCount; i++) {
        Peripheral* peripheral = bleManager->getCurrentMode()->getPeripheral(i);
        if(peripheral != nullptr) {
            bool isAvoid = false;
            for(uint8_t j = 0; j < avoidCount; j++) {
                if(selectedAvoids[j] == i) {
                    isAvoid = true;
                    break;
                }
            }
            if(isAvoid) {
                peripheral->setActionMode(PeripheralActionMode::AVOID);
            } else {
                peripheral->setActionMode(PeripheralActionMode::HIT);
            }
        }
    }

    for(uint8_t j = 0; j < avoidCount; j++) {
        if(selectedAvoids[j] == this->remainingCount) {
            this->centralIsAvoid = true;
            break;
        }
    }



    if(this->centralIsAvoid) {
        ledManager->setLEDColors(RED);
    } else {
        ledManager->setLEDColors(GREEN);
    }

    //now reduce remaining count variable by the amount of avoid buzzers
    this->remainingCount -= avoidCount;
    this->remainingCount++; //add one to account for central;

    return 0;
}

block_err_t RemoteMultiplePressBlock::executeBlock() {
    //check if peripheral was queued
    BLEManager* bleManager = BLEManager::getManager();
    if (!bleManager->getCurrentMode()->peripheralQueue.empty()) {
        Peripheral* peripheral = bleManager->getCurrentMode()->peripheralQueue.front();
        bleManager->getCurrentMode()->peripheralQueue.pop();
        
        if (peripheral != nullptr) {
            Serial.print("Remaining count: ");
            Serial.println(this->remainingCount);
            peripheral->resetPeripheral();
            if(peripheral->getActionMode() == PeripheralActionMode::AVOID) {
                Serial.print("AVOID was hit!");
                this->avoidWasHit = true;
            } else {
                this->remainingCount--;
                if(this->remainingCount == 254) { //underflow, means all were hit
                    this->remainingCount = 0;
                }
            }
        }
    }

    if(digitalRead(PIN_BUTTON_PRESS) == LOW && this->localPressed == false) { // Assuming LOW means pressed 
        this->localPressed = true;
        LEDManager::getManager()->turnOff();
        if(this->centralIsAvoid) {
            this->avoidWasHit = true;
        } else{
            this->remainingCount--;
            if(this->remainingCount == 254) { //underflow, means all were hit
                this->remainingCount = 0;
            }
        }
    }


    return 0;
}


void RemoteMultiplePressBlock::reset() {
    this->timestamp = millis();
    this->tmpState = 0;
    this->remainingCount = 0;
    this->localPressed = false;
    this->avoidWasHit = false;
    this->centralIsAvoid = false;
}