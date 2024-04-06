#pragma once

#include <Arduino.h>
#include "PodModes/ParentPod/NodeManager/VNode.h"
#include "LEDManager/LEDManager.h"

class ManagingNode : public VNode
{
    protected: 
        LEDManager* ledManager;
        
    public:
        ManagingNode(LEDManager* ledManager);

        virtual void pressed(uint64_t timestamp);
        virtual void activate(uint8_t colorId);
        void deactivate();
        virtual bool isPressed();

};