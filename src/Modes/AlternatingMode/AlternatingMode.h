#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "../VMode.h"
#include "LEDManager/LEDManager.h"
#include "BLEDataField/BLELongDataField.h"
#include "PodModes/ParentPod/NodeManager/NodeManager.h"

class AlternatingMode : public VMode 
{
    protected:
        uint8_t internalState = 0;
        uint8_t numberOfSets = 0;
        uint8_t setCounter = 0;

    public:
        AlternatingMode(LEDManager* ledManager, uint8_t numberOfSets);
        void run(uint64_t timestamp) override;
        void reset() override;
};