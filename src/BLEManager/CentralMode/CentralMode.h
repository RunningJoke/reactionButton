#ifndef CENTRALMODE_H
#define CENTRALMODE_H    

#include "../BLEManager.h"
#include "../IBuzzerMode.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLECharacteristic.h>
#include <BLEDescriptor.h>
#include <BLEService.h>
#include <BLERemoteCharacteristic.h>
#include <BLERemoteService.h>
#include <LEDManager/LEDManager.h>
#include <BlockManager/BlockManager.h>
#include "Peripheral/Peripheral.h"
#include "VariableManager/VariableManager.h"
#include "BlockConfigs.h"
#include "../ErrorAnimation.h"

#include <queue>

enum class BLECentralState {
    WAITING_FOR_MODEL_SELECTION,
    WAITING_FOR_PERIPHERALS,
    CONFIRM,
    RUN_BLOCK_MANAGER,
    ERROR
};



class CentralMode : public IBuzzerMode
{
private:
        BLECentralState centralState;

        uint64_t modelSelectorPressStart;
        uint8_t modelSelectorCounter;
        ColorSet* modelSelectorColor;

        uint8_t selectedModel;

        bool runModelSelector();
protected:
        Peripheral* peripherals[32];  
        uint8_t requiredPeripherals = 0;
        uint8_t connectedPeripherals = 0;

        BLECharacteristic* maxLoopCharacteristic;

        uint8_t waitingForPeripheral = 0;

        uint64_t centralTimer;

        static std::map<BLERemoteCharacteristic*, Peripheral*> notifyMap;


        int64_t phoneOverrideLoopCount = -1;
        int64_t phoneOverridePeripheralCount = -1;

        void clientScanForPeripherals();
        void startConfigurationBLE();
public:
        CentralMode();

        void runMode() override;
        
        Peripheral* getPeripheral(uint8_t peripheralId) override;

        static void notifyCallback(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void subscribeNotify(BLERemoteCharacteristic* pChar, Peripheral* peripheral) override;
        void handleNotify(Peripheral* peripheral) override;
};



#endif