#include "BLEColorDataField.h"

BLEColorDataField::BLEColorDataField(uint16_t fieldId , BLECharacteristic *pCharacteristic, bool isNotify)
{
    this->isNotify = isNotify;
    this->fieldId = fieldId;
    this->pDefinedCharacteristic = pCharacteristic;

    this->definedColorSet = new ColorSet{0,0,0};
}


ColorSet* BLEColorDataField::getColor() {
    return this->definedColorSet;
}

void BLEColorDataField::updateColorData() {
    char tmpData[8] = {'0' , '0' , '0' , '0' , '0' , '0' , '0' , '0'};
    std::string fullVal = this->pDefinedCharacteristic->getValue();
    this->definedColorSet->red =  fullVal[0];
    this->definedColorSet->green =  fullVal[1];
    this->definedColorSet->blue =  fullVal[2];
}