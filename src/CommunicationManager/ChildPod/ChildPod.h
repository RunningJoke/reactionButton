#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "../VPod.h"
#include "LEDManager/LEDManager.h"


class ChildPod : public VPod {
    private:
        LEDManager* ledManager;
        uint8_t currentStatus;
        uint8_t discoveryTries;
        uint64_t lastDiscoveryTry;

        
        

        BLELongDataField *pModeField = nullptr;
    public:
        ChildPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;
    
};

