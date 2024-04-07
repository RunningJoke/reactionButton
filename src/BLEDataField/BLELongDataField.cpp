#include "BLELongDataField.h"

BLELongDataField::BLELongDataField(uint16_t fieldId , BLECharacteristic *pCharacteristic, bool isNotify)
{
    this->isNotify = isNotify;
    this->fieldId = fieldId;
    this->pDefinedCharacteristic = pCharacteristic;

    this->currentValue = 0;
}

uint64_t BLELongDataField::getValue()
{
    this->fetchValue();
    return this->currentValue;
}

void BLELongDataField::fetchValue()
{
    this->currentValue = atoll((char*)this->pDefinedCharacteristic->getData());
}

void BLELongDataField::setValue(uint64_t val)
{
    this->currentValue = val;
    char buffer[32];
    sprintf(buffer, "%llu" , this->currentValue);
    this->pDefinedCharacteristic->setValue(buffer);

    if(this->isNotify) {
        this->pDefinedCharacteristic->notify();
    }
}

