#ifndef PERIPHERAL_H
#define PERIPHERAL_H

#include <string>
#include <BLEAdvertisedDevice.h>
#include <BLEUtils.h>
#include <BLEClient.h>
#include <BLEDevice.h>
#include <BLEService.h>
#include <BLERemoteCharacteristic.h>
#include <BLERemoteService.h>
#include "_Definitions.h"
#include "BLEManager/IBuzzerMode.h"

enum class PeripheralActionMode : uint8_t {
    HIT = '1',
    AVOID = '2',
    COUNTER = '3',
    COUNTDOWN = '4',
};


class Peripheral {
    public:
        Peripheral(BLEAdvertisedDevice advertisedDevice, uint8_t peripheralId, IBuzzerMode* mode);

        // Set the LED color characteristic value
        void setLedColor(const std::string& color);

        // Set the action mode characteristic value
        void setActionMode(PeripheralActionMode actionMode);
        PeripheralActionMode getActionMode();

        void activate();

        bool isConnected();

        void handleNotify(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void resetPeripheral();
        IBuzzerMode* mode; // Pointer to the mode (CentralMode or ServerMode) that manages this peripheral

        uint64_t peripheralTimer; // Timer for the peripheral
    
    protected:

        PeripheralActionMode actionMode;

        BLEAdvertisedDevice advertisedDevice; // The advertised device information
        uint8_t peripheralId; // Unique ID for the peripheral
        BLERemoteService* remoteService; // Remote service associated with the peripheral
        BLEClient* pClient; // BLE client to connect to the peripheral

        BLERemoteCharacteristic* teamIdCharacteristic; // Characteristic for team ID
        BLERemoteCharacteristic* ledColorCharacteristic; // Characteristic for LED color 
        BLERemoteCharacteristic* actionModeCharacteristic; // Characteristic for action mode
        BLERemoteCharacteristic* notifyCharacteristic; // Characteristic for notifications
        BLERemoteCharacteristic* resetCharacteristic; 

};

#endif