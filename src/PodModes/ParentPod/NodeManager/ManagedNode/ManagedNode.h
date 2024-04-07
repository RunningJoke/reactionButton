#pragma once

#include "_Definitions.h"
#include <BLEClient.h>
#include <BLEAddress.h>
#include <BLEClient.h>
#include <BLEDevice.h>
#include "PodModes/ParentPod/NodeManager/VNode.h"
#include "PodModes/ParentPod/NodeManager/NodeManager.h"

class ManagedNode : public VNode
{
    protected:
        BLEClient* pClient;
        bool wasPressed;
        BLERemoteCharacteristic* activationSignal;
    public:
        ManagedNode(BLEAdvertisedDevice advertisedDevice, uint8_t id);

        virtual void pressed(uint64_t timestamp);
        virtual void activate(const char* messageId);
        void deactivate();
        virtual bool isPressed();
        
};