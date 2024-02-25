#pragma once

#include "BLEDataField/VBLEDataField.h"

class BLELongDataField : public VBLEDataField
{

    public:
        BLELongDataField(uint16_t fieldId , BLECharacteristic *pCharacteristic, bool isNotify);
        uint64_t getValue();
        void fetchValue();
        void setValue(uint64_t val);

    protected:
        uint64_t currentValue;
};