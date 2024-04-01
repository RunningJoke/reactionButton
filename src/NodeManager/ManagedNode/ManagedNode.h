#pragma once

#include <BLEClient.h>
#include <BLEAddress.h>
#include "NodeManager/VNode.h"

class ManagedNode : public VNode
{
    protected:
        BLEClient* pClient;
    public:
        ManagedNode(BLEAddress managedNodeAddress);
        
};