#ifndef SERVERMODE_H
#define SERVERMODE_H    

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


enum class BLEPeripheralState {
    WAITING_FOR_CONNECTION,
    CONNECTED,
    READY,
    ACTIVE,
    WAIT_FOR_RESET
};


class ServerMode : public IBuzzerMode
{
private:
    BLECharacteristic* teamIdCharacteristic;
    BLECharacteristic* ledColorCharacteristic;
    BLECharacteristic* actionModeCharacteristic;
    BLECharacteristic* resetCharacteristic;
    BLECharacteristic* notifyCharacteristic;
    
    BLEPeripheralState peripheralState;

    
    uint64_t peripheralTimer;

public:
    ServerMode();

    void runMode() override;
    void subscribeNotify(BLERemoteCharacteristic* pChar, class Peripheral* peripheral) override {};
    void handleNotify(class Peripheral* peripheral) override {};

    Peripheral* getPeripheral(uint8_t peripheralId) override { return nullptr; }
};



#endif