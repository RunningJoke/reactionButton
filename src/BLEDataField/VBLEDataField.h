#pragma once

#include <Arduino.h>
#include <BLEDevice.h>

class VBLEDataField {
    public:
        uint16_t getId();
    protected:
        bool isNotify = false;
        uint16_t fieldId;
        BLECharacteristic *pDefinedCharacteristic = nullptr;

};