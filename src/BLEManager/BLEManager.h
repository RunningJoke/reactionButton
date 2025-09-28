#ifndef BLEMANAGER_H
#define BLEMANAGER_H

#include "_Definitions.h"
#include "esp_log.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEClient.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLECharacteristic.h>
#include <BLEDescriptor.h>
#include <BLEService.h>
#include <BLERemoteCharacteristic.h>
#include <BLERemoteService.h>
#include <LEDManager/LEDManager.h> 
#include <BlockManager/BlockManager.h>
#include "VariableManager/VariableManager.h"
#include "IBuzzerMode.h"
#include "ServerMode/ServerMode.h" 
#include "CentralMode/CentralMode.h"
#include "BlockConfigs.h"



class Peripheral; // Forward declaration of Peripheral


enum class BLEMode {
    CENTRAL,
    PERIPHERAL
};



class BLEManager {
    private:
        BLEManager();
        static BLEManager* manager;
        IBuzzerMode* currentMode = nullptr;

    protected:

       

    public:
        static BLEManager* getManager();

        void bootMode(BLEMode mode);

        void runCurrentMode();

        IBuzzerMode* getCurrentMode();


};

#endif