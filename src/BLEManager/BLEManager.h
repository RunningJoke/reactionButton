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
#include "BlockConfigs.h"


#include <queue>

class Peripheral; // Forward declaration of Peripheral

enum class BLEMode {
    CENTRAL,
    PERIPHERAL
};

enum class BLEPeripheralState {
    WAITING_FOR_CONNECTION,
    CONNECTED,
    READY,
    ACTIVE,
    WAIT_FOR_RESET
};

enum class BLECentralState {
    WAITING_FOR_MODEL_SELECTION,
    WAITING_FOR_PERIPHERALS,
    CONFIRM,
    RUN_BLOCK_MANAGER,
    ERROR
};


class BLEManager {
    private:
        BLEManager();
        static BLEManager* manager;

        BLEPeripheralState peripheralState;

        BLECentralState centralState;

        uint64_t modelSelectorPressStart;
        uint8_t modelSelectorCounter;
        ColorSet* modelSelectorColor;

        uint8_t selectedModel;

        bool runModelSelector();

    protected:
        void startServer();
        void startClient();

        void clientScanForPeripherals();

        Peripheral* peripherals[32];  
        uint8_t requiredPeripherals = 0;
        uint8_t connectedPeripherals = 0;

        BLECharacteristic* teamIdCharacteristic;
        BLECharacteristic* ledColorCharacteristic;
        BLECharacteristic* actionModeCharacteristic;
        BLECharacteristic* notifyCharacteristic;

        uint8_t waitingForPeripheral = 0;

        uint64_t peripheralTimer;
        uint64_t centralTimer;

        static std::map<BLERemoteCharacteristic*, Peripheral*> notifyMap;

    public:
        std::queue<Peripheral*> peripheralQueue; 
        static BLEManager* getManager();

        void bootMode(BLEMode mode);

        void runAsPeripheral();
        void runAsCentral();

        Peripheral* getPeripheral(uint8_t peripheralId);

        static void notifyCallback(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void subscribeNotify(BLERemoteCharacteristic* pChar, Peripheral* peripheral);
        void handleNotify(Peripheral* peripheral);


};

#endif