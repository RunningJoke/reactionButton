#include "RemotePressBlock.h"
#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"


RemotePressBlock::RemotePressBlock(RemotePressBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = blockConfiguration;
    this->genericBlockConfiguration = blockConfiguration; // Set the generic block configuration
    this->activated = false;
    this->blockConfiguration->parentBlock = this; // Set the parent block reference
}

RemotePressBlock::~RemotePressBlock() {
    // Destructor implementation
}

block_err_t RemotePressBlock::enterBlock() {
    this->reset();
    BLEManager* bleManager = BLEManager::getManager();
    VariableManager* variableManager = VariableManager::getManager();
    bleManager->getPeripheral((uint8_t)variableManager->getVariable(this->blockConfiguration->peripheralIdVariableName))->activate();
    this->activated = false;

    return 0;
}

block_err_t RemotePressBlock::executeBlock() {
    //check if peripheral was queued
    BLEManager* bleManager = BLEManager::getManager();
    if (!bleManager->peripheralQueue.empty()) {
        Peripheral* peripheral = bleManager->peripheralQueue.front();
        bleManager->peripheralQueue.pop();
        
        if (peripheral != nullptr) {
            this->activated = true;
            peripheral->resetPeripheral();
        }
    }


    return 0;
}


void RemotePressBlock::reset() {
    this->timestamp = millis();
    this->tmpState = 0;
    this->activated = false;
}