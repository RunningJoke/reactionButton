#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"

#include "ErrorAnimation.h"

BLEManager* BLEManager::manager = nullptr;



BLEManager* BLEManager::getManager() {

    if(BLEManager::manager == nullptr) {        
        BLEManager::manager = new BLEManager();
    }

    return BLEManager::manager;
};

BLEManager::BLEManager() {
}


void BLEManager::bootMode(BLEMode mode) {
    
    switch (mode) {
        case BLEMode::CENTRAL:
            Serial.println("Booting in Central mode");
            this->currentMode = new CentralMode();
            break;
        case BLEMode::PERIPHERAL:
            Serial.println("Booting in Peripheral mode");
            this->currentMode = new ServerMode();
            break;
        default:
            Serial.println("Unknown BLE mode");
            break;
    }
}

void BLEManager::runCurrentMode() {
    if(this->currentMode != nullptr) {
        this->currentMode->runMode();
    }
}

IBuzzerMode* BLEManager::getCurrentMode() {
    return this->currentMode;
}

