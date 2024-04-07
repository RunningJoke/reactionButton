#pragma once

#include <BLEDevice.h>
#include "BLEDataField/VBLEDataField.h"
#include "ColorSet/ColorSet.h"

class BLEColorDataField : public VBLEDataField
{

    public:
        BLEColorDataField(uint16_t fieldId , BLECharacteristic *pCharacteristic, bool isNotify);
        ColorSet* getColor();
        void updateColorData();

    protected:
        ColorSet* definedColorSet;
};