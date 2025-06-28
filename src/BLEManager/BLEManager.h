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


// UUIDs for GATT characteristics
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHAR_TEAM_ID_UUID      "12345678-1234-1234-1234-1234567890ac"
#define CHAR_LED_COLOR_UUID    "12345678-1234-1234-1234-1234567890ad"
#define CHAR_ACTION_MODE_UUID  "12345678-1234-1234-1234-1234567890ae"
#define CHAR_NOTIFY_UUID       "12345678-1234-1234-1234-1234567890af"

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

        BLERemoteService* remoteService[2];  
        uint8_t requiredPeripherals = 1;
        uint8_t connectedPeripherals = 0;

        BLECharacteristic* teamIdCharacteristic;
        BLECharacteristic* ledColorCharacteristic;
        BLECharacteristic* actionModeCharacteristic;
        BLECharacteristic* notifyCharacteristic;

        uint8_t waitingForPeripheral = 0;

        uint64_t peripheralTimer;
        uint64_t centralTimer;

        static std::map<BLERemoteCharacteristic*, BLEManager*> notifyMap;

    public:
        static BLEManager* getManager();

        void bootMode(BLEMode mode);

        void runAsPeripheral();
        void runAsCentral();

        static void notifyCallback(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void subscribeNotify(BLERemoteCharacteristic* pChar);
        void handleNotify(BLERemoteCharacteristic* pChar, uint8_t* pData, size_t length, bool isNotify);


};

#endif