#pragma once

#include <Arduino.h>
#include <BLECharacteristic.h>

class VBLEDataField {
    public:
        uint16_t getId();
    protected:
        bool isNotify = false;
        uint16_t fieldId;
        BLECharacteristic *pDefinedCharacteristic = nullptr;

};