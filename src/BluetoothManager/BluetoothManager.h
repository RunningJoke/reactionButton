#pragma once

#include "_Definitions.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

#include "BLEDataField/VBLEDataField.h"
#include "BLEDataField/BLEColorDataField.h"
#include "BLEDataField/BLELongDataField.h"

#define BLE_FIELDTYPE_LONG 1
#define BLE_FIELDTYPE_STRING 2
#define BLE_FIELDTYPE_COLOR 3



class BluetoothManager {
    public:
        BluetoothManager();
        BLEColorDataField* getColorDataField(uint16_t fieldId);
        BLELongDataField* getLongDataField(uint16_t fieldId);
        
        VBLEDataField* createCharacteristic(uint16_t characteristicName, char* uuid, uint8_t type, uint32_t characteristicModes);

        void startBLEService();
    protected:
        VBLEDataField* fieldArray[10];
        BLEServer *pServer = nullptr;
        BLEService *pService = nullptr;
        BLEAdvertising *pAdvertising = nullptr;
};