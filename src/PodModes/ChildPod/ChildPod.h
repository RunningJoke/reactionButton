#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "../VPod.h"
#include "LEDManager/LEDManager.h"
#include "Modes/ReactionMode/ReactionMode.h"


class ChildPod : public VPod {
    private:
        LEDManager* ledManager;
        uint8_t currentStatus;
        uint8_t discoveryTries;
        uint64_t lastDiscoveryTry;

        VMode* currentMode;

        uint64_t stopwatchTimer;
        

        BLELongDataField *pModeField = nullptr;
        BLELongDataField *pActivationField = nullptr;
        BLELongDataField *pStopwatchField = nullptr;
    public:
        ChildPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;

    protected:
        void blink(ColorSet* color, uint8_t repetitions);
    
};

