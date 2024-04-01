#include "NodeManager.h"


VNode* NodeManager::nodeList[5];
uint8_t NodeManager::nodeCount;
ProgramStep* NodeManager::steps[100];
uint8_t NodeManager::currentStep = 0;
LEDManager* NodeManager::ledManager = nullptr;

VNode* NodeManager::getNode(uint8_t nodeId)
{
    return NodeManager::nodeList[nodeId];
}

uint8_t NodeManager::getNodeCount()
{
    return NodeManager::nodeCount;
}

VNode* NodeManager::registerManagingNode()
{
    NodeManager::nodeList[0] = new ManagingNode(NodeManager::ledManager);
    NodeManager::nodeCount = 1;

    return NodeManager::nodeList[0];
}

VNode* NodeManager::registerNode(BLEAdvertisedDevice device)
{
    Serial.println("Registering node");
    NodeManager::nodeList[NodeManager::nodeCount] = new ManagedNode(device, NodeManager::nodeCount);

    NodeManager::nodeCount++;

    return NodeManager::getNode(NodeManager::nodeCount - 1);
}



void NodeManager::nodeNotifyCallback_1(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    Serial.println("Button 1 pressed");
    NodeManager::nodeList[1]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_2(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    Serial.println("Button 2 pressed");
    NodeManager::nodeList[2]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_3(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    Serial.println("Button 3 pressed");
    NodeManager::nodeList[3]->pressed(millis());
}

void NodeManager::nodeNotifyCallback_4(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    Serial.println("Button 4 pressed");
    NodeManager::nodeList[4]->pressed(millis());
}
