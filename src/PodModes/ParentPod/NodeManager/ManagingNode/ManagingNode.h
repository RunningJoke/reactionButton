#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "PodModes/ParentPod/NodeManager/VNode.h"
#include "LEDManager/LEDManager.h"

class ManagingNode : public VNode
{
    protected: 
        LEDManager* ledManager;
        void blink(ColorSet* color, uint8_t repetitions);
        
    public:
        ManagingNode(LEDManager* ledManager);

        virtual void pressed(uint64_t timestamp);
        virtual void activate(const char* colorId);
        void deactivate();
        virtual bool isPressed();

};