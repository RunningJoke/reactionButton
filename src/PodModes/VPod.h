#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include "BLEDataField/VBLEDataField.h"
#include "BLEDataField/BLEColorDataField.h"
#include "BLEDataField/BLELongDataField.h"

#define BLE_FIELDTYPE_LONG 1
#define BLE_FIELDTYPE_STRING 2
#define BLE_FIELDTYPE_COLOR 3


class VPod {
    protected:
        BLEServer *pServer = nullptr;
        BLEService *pService = nullptr;
        BLEAdvertising *pAdvertising = nullptr;
        VBLEDataField* fieldArray[10];
    public:
        virtual void start() = 0;
        virtual void stop() = 0;
        virtual int8_t update(uint64_t timestamp) = 0;

        BLEColorDataField* getColorDataField(uint16_t fieldId);
        BLELongDataField* getLongDataField(uint16_t fieldId);
        
        VBLEDataField* createCharacteristic(uint16_t characteristicName, char* uuid, uint8_t type, uint32_t characteristicModes);
};