#include "BluetoothManager.h"

BluetoothManager::BluetoothManager()
{
    BLEDevice::init("ReactionPod 1");
    this->pServer = BLEDevice::createServer();
    this->pService = pServer->createService(BLE_REACTION_POD_ID);
}

void BluetoothManager::startBLEService()
{
    this->pService->start();
    this->pAdvertising = BLEDevice::getAdvertising();
    this->pAdvertising->addServiceUUID(BLE_REACTION_POD_ID);
    this->pAdvertising->setScanResponse(true);
    this->pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    this->pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();
}

VBLEDataField* BluetoothManager::createCharacteristic(uint16_t characteristicName, char* uuid, uint8_t type, uint32_t characteristicModes)
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

BLEColorDataField* BluetoothManager::getColorDataField(uint16_t fieldId)
{
    return static_cast<BLEColorDataField*>(this->fieldArray[fieldId]);
}

BLELongDataField* BluetoothManager::getLongDataField(uint16_t fieldId)
{
    return static_cast<BLELongDataField*>(this->fieldArray[fieldId]);
}

