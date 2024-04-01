#include "ManagedNode.h"

ManagedNode::ManagedNode(BLEAdvertisedDevice advertisedDevice, uint8_t id)
{
    Serial.println("creating managed node");
    this->pClient = BLEDevice::createClient();
    this->pClient->connect(&advertisedDevice);
    Serial.println("Successfully connected");
    BLERemoteService* pRemoteService = this->pClient->getService(BLEUUID(BLE_REACTION_POD_ID));
    Serial.println("Service found");
            
    this->activationSignal = pRemoteService->getCharacteristic(BLE_ACTIVATION_UID);

    BLERemoteCharacteristic* modeCharacteristic = pRemoteService->getCharacteristic(BLE_MODE_UID);

    modeCharacteristic->writeValue('1');   
    Serial.println("Characteristic written");

    BLERemoteCharacteristic* stopWatchCharacteristic = pRemoteService->getCharacteristic(BLE_REACTION_TIME_UID);
    switch(id) {
        case 1: stopWatchCharacteristic->registerForNotify(NodeManager::nodeNotifyCallback_1); break;
        case 2: stopWatchCharacteristic->registerForNotify(NodeManager::nodeNotifyCallback_2); break;
        case 3: stopWatchCharacteristic->registerForNotify(NodeManager::nodeNotifyCallback_3); break;
        case 4: stopWatchCharacteristic->registerForNotify(NodeManager::nodeNotifyCallback_4); break;
    }         
}

void ManagedNode::pressed(uint64_t timestamp)
{
    this->lastTimePressed = timestamp;
    this->wasPressed = true;
}

void ManagedNode::activate(uint8_t colorId)
{
    this->wasPressed = false;
    this->lastTimePressed = millis();
    this->activationSignal->writeValue('1');

}

void ManagedNode::deactivate()
{
    
}

bool ManagedNode::isPressed()
{
    return this->wasPressed;
}
