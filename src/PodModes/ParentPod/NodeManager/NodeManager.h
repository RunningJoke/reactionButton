#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "ManagedNode/ManagedNode.h"
#include "ManagingNode/ManagingNode.h"
#include "PodModes/ParentPod/ProgramStep/ProgramStep.h"
#include "LEDManager/LEDManager.h"


class NodeManager
{
    protected:
        static VNode* nodeList[5];
        static uint8_t nodeCount;


        static ProgramStep* steps[100];
        static uint8_t currentStep;
    
    private:
    public:        
        static LEDManager* ledManager;

        static VNode* registerManagingNode();

        static VNode* getNode(uint8_t nodeId);

        static uint8_t getNodeCount();

        static VNode* registerNode(BLEAdvertisedDevice device);

        static void deactivateAllNodes();
        static void activateAllNodes(const char* commandId);
        static void activateAllNodes(uint8_t commandId);

        static void runProgram();



        static void nodeNotifyCallback_1(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_2(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_3(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_4(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);




};