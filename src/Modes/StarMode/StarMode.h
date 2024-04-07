#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "../VMode.h"
#include "LEDManager/LEDManager.h"
#include "BLEDataField/BLELongDataField.h"
#include "PodModes/ParentPod/NodeManager/NodeManager.h"

class StarMode : public VMode 
{
    protected:
        uint8_t internalState = 0;
        uint8_t numberOfPresses = 0;
        uint8_t setCounter = 0;
        uint8_t nodeCount = 0;
        uint8_t currentPodId = 0;

    public:
        StarMode(LEDManager* ledManager, uint8_t nodeCount, uint8_t numberOfPresses);
        void run(uint64_t timestamp) override;
        void reset() override;
};