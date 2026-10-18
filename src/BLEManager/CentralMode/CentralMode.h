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
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <LEDManager/LEDManager.h>
#include <BlockManager/BlockManager.h>
#include "Peripheral/Peripheral.h"
#include "VariableManager/VariableManager.h"
#include "Program/ProgramCatalog.h"
#include "../ErrorAnimation.h"

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
        static const uint8_t MAX_PERIPHERALS = 7;

        BLECentralState centralState;

        uint64_t modelSelectorPressStart = 0;
        uint8_t modelSelectorCounter = 0;
        ColorSet* modelSelectorColor;

        uint8_t selectedModel = 0;
        bool waitForBootRelease = false;   // button still held from selecting CENTRAL at boot

        ProgramCatalog catalog;

        bool runModelSelector();
        bool loadSelectedProgram();
protected:
        Peripheral* peripherals[MAX_PERIPHERALS] = {};
        uint8_t requiredPeripherals = 0;
        uint8_t connectedPeripherals = 0;

        BLECharacteristic* maxLoopCharacteristic;

        QueueHandle_t eventQueue;

        static std::map<BLERemoteCharacteristic*, Peripheral*> notifyMap;

        void clientScanForPeripherals();
        void startConfigurationBLE();
public:
        CentralMode();

        void runMode() override;

        Peripheral* getPeripheral(uint8_t peripheralId) override;
        uint8_t getPeripheralCount() override { return this->connectedPeripherals; }
        bool pollEvent(PodEvent& event) override;

        static void notifyCallback(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void subscribeNotify(BLERemoteCharacteristic* pChar, Peripheral* peripheral) override;
        void handleNotify(Peripheral* peripheral) override;
};



#endif
