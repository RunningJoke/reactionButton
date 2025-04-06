#pragma once

#include "../VPod.h"
#include "LEDManager/LEDManager.h"
#include "Modes/ReactionMode/ReactionMode.h"


enum class PodStatus : uint8_t { EMPTY , ADDED , ACKNOWLEDGED  };
class ParentPod : public VPod {
    public:
        ParentPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;
        
    protected:
        PodStatus linkedChildrenStatus[10];
        uint8_t linkedChildrenCount = 0;

        VMode* activeMode;

    private:
        LEDManager* ledManager; 
        uint8_t currentStatus;
};
