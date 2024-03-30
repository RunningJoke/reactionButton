#pragma once

#include "../VPod.h"
#include "LEDManager/LEDManager.h"


class ChildPod : public VPod {
    private:
        LEDManager* ledManager;
        uint8_t currentStatus;
        uint8_t discoveryTries;
        uint64_t lastDiscoveryTry;
    public:
        ChildPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;

        void handleData(const uint8_t *data, int data_len);

        

};


#include "ChildPodESPNowHandler.h"