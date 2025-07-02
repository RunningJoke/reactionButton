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


class BLEManager {
    private:
        BLEManager();
        static BLEManager* manager;

        BLEPeripheralState peripheralState;

    protected:
        void startServer();
        void startClient();

        void clientScanForPeripherals();

        Peripheral* peripherals[32];  
        uint8_t requiredPeripherals = 1;
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
        static BLEManager* getManager();

        void bootMode(BLEMode mode);

        void runAsPeripheral();
        void runAsCentral();

        static void notifyCallback(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void subscribeNotify(BLERemoteCharacteristic* pChar, Peripheral* peripheral);
        void handleNotify(Peripheral* peripheral);


};

#endif