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

// Colour indices understood by the peripheral firmware
namespace RemoteColor {
    const uint8_t RED = 0;
    const uint8_t GREEN = 1;
    const uint8_t OFF = 255;
}


class Peripheral {
    public:
        Peripheral(BLEAdvertisedDevice advertisedDevice, uint8_t peripheralId, IBuzzerMode* mode);

        // true if connected and all characteristics were found
        bool isValid();

        // Lights the peripheral and starts its timer. colorActive while waiting, colorAfter once pressed.
        void arm(PeripheralActionMode actionMode, uint8_t colorActive, uint8_t colorAfter);

        // Set the action mode with the default colours (HIT green, AVOID red)
        void setActionMode(PeripheralActionMode actionMode);
        PeripheralActionMode getActionMode();

        void activate();

        bool isConnected();
        void disconnect();

        void handleNotify(
            BLERemoteCharacteristic* pChar,
            uint8_t* pData, size_t length, bool isNotify
        );

        void resetPeripheral();

        uint8_t getId() const { return this->peripheralId; }

        IBuzzerMode* mode; // Pointer to the mode (CentralMode or ServerMode) that manages this peripheral

        int32_t lastResult = 0; // last value notified by the peripheral (reaction ms, -1 = avoid pressed)

    protected:

        PeripheralActionMode actionMode = PeripheralActionMode::HIT;

        BLEAdvertisedDevice advertisedDevice; // The advertised device information
        uint8_t peripheralId; // Unique ID for the peripheral
        BLERemoteService* remoteService = nullptr; // Remote service associated with the peripheral
        BLEClient* pClient = nullptr; // BLE client to connect to the peripheral

        BLERemoteCharacteristic* teamIdCharacteristic = nullptr; // Characteristic for team ID
        BLERemoteCharacteristic* ledColorCharacteristic = nullptr; // Characteristic for LED color
        BLERemoteCharacteristic* actionModeCharacteristic = nullptr; // Characteristic for action mode
        BLERemoteCharacteristic* notifyCharacteristic = nullptr; // Characteristic for notifications
        BLERemoteCharacteristic* resetCharacteristic = nullptr;

};

#endif
