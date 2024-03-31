#pragma once

#include <Arduino.h>
#include "_Definitions.h"
#include "../VMode.h"
#include "LEDManager/LEDManager.h"
#include "BLEDataField/BLELongDataField.h"

class ReactionMode : public VMode 
{
    protected:
        uint8_t internalState = 0;
        uint64_t internalTimerStart = 0;
        uint64_t reactionTimerStart = 0;
        uint64_t reactionTimerStop = 0;
        uint64_t reactionTimerDelay = 0;
        LEDManager* ledManager;

        BLELongDataField* stopwatchField;

        void blink(ColorSet* color, uint8_t repetitions);
    public:
        ReactionMode(LEDManager* ledManager , BLELongDataField* stopwatchField);
        void run(uint64_t timestamp) override;
        void reset() override;
};