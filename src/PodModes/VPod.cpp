#include "VPod.h"

VBLEDataField* VPod::createCharacteristic(uint16_t characteristicName, char* uuid, uint8_t type, uint32_t characteristicModes)
{
    BLECharacteristic *pNewCharacteristic = this->pService->createCharacteristic(uuid, characteristicModes);
    VBLEDataField *pNewDataField = nullptr;
    switch(type)
    {        
        case BLE_FIELDTYPE_STRING:
            break;
        case BLE_FIELDTYPE_COLOR:
            break;
        case BLE_FIELDTYPE_LONG:
        default:
        {
            pNewDataField = new BLELongDataField(
                characteristicName , 
                pNewCharacteristic , 
                CHECK_BIT(characteristicModes, 2) );
            break;
        }
    }

    this->fieldArray[characteristicName] = pNewDataField;
    return this->fieldArray[characteristicName];
    
}

BLEColorDataField* VPod::getColorDataField(uint16_t fieldId)
{
    return static_cast<BLEColorDataField*>(this->fieldArray[fieldId]);
}

BLELongDataField* VPod::getLongDataField(uint16_t fieldId)
{
    return static_cast<BLELongDataField*>(this->fieldArray[fieldId]);
}