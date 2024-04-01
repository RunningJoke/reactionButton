#include "NodeManager.h"

ManagedNode* NodeManager::getNode(uint8_t nodeId)
{

}

ManagedNode* NodeManager::registerNode(BLEAddress* address)
{

}


void NodeManager::nodeNotifyCallback_1(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    NodeManager::nodeList[1]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_2(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    NodeManager::nodeList[2]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_3(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    NodeManager::nodeList[3]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_4(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    NodeManager::nodeList[4]->pressed(millis());
}
