#include "RemoteResetAllBlocks.h"
#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"


RemoteResetAllBlocks::RemoteResetAllBlocks(RemoteResetAllBlocksConfiguration* blockConfiguration) {
    this->blockConfiguration = blockConfiguration;
    this->genericBlockConfiguration = blockConfiguration; // Set the generic block configuration
}

RemoteResetAllBlocks::~RemoteResetAllBlocks() {
    // Destructor implementation
}


block_err_t RemoteResetAllBlocks::executeBlock() {
    //check if peripheral was queued
    BLEManager* bleManager = BLEManager::getManager();
    uint8_t nodeCount = (uint8_t)VariableManager::getManager()->getVariable(this->blockConfiguration->peripheralCountVariableName);

    for(uint8_t i = 0; i < nodeCount; i++) {
        Peripheral* peripheral = bleManager->getCurrentMode()->getPeripheral(i);
        if(peripheral != nullptr) {
            peripheral->resetPeripheral();
        }
    }

    LEDManager::getManager()->turnOff();

    return 0;
}
