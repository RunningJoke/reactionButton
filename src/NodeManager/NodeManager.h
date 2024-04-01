#pragma once

#include "ManagedNode/ManagedNode.h"
#include "ProgramStep/ProgramStep.h"

class NodeManager
{
    protected:
        static ManagedNode* nodeList[5];
        static uint8_t nodeCount;

        static ProgramStep* steps[100];
        static uint8_t currentStep;
    
    private:
    public:

        static ManagedNode* getNode(uint8_t nodeId);

        static ManagedNode* registerNode(BLEAddress* address);

        static void runProgram();



        static void nodeNotifyCallback_1(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_2(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_3(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        static void nodeNotifyCallback_4(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);




};