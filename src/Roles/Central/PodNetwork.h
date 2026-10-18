#pragma once

#include <Arduino.h>
#include <deque>
#include <vector>
#include "Link/IPodNetwork.h"
#include "Link/EspNowLink.h"
#include "Store/StoreSync.h"

/**
 * Central side of the pod link.
 *
 * - Claims peripherals that announce themselves with HELLO (one claim at a time, so pod
 *   ids are given out in order without gaps).
 * - A peripheral that rebooted announces itself again; it is re-claimed with its old id.
 * - Answers PINGs (heartbeat + clock sync). A pod without PING for POD_TIMEOUT_US is lost.
 * - The central's esp_timer is the network time base.
 * - Runs the program store sync with the peripherals (StoreSync), only while allowed.
 */
class PodNetwork : public IPodNetwork {
    public:
        bool begin(uint32_t setId);

        // While enabled, unknown peripherals are claimed until maxPods are in the set
        void setAcceptNewPods(bool accept, uint8_t maxPods);

        // Processes received frames. Call once per loop pass.
        void service();

        // Program store sync in both directions; switch off while a game runs
        void setSyncAllowed(bool allowed);

        bool allAlive() const;

        uint8_t podCount() const override { return (uint8_t)this->pods.size(); }
        bool isAlive(uint8_t podId) const override;
        uint8_t arm(uint8_t podId, const ArmCommand& command) override;
        void reset(uint8_t podId) override;
        bool pollEvent(PodEvent& event) override;
        int64_t nowUs() const override { return esp_timer_get_time(); }

    private:
        static const int64_t POD_TIMEOUT_US = 1500000;
        static const int64_t CLAIM_TIMEOUT_US = 500000;

        struct Pod {
            uint8_t mac[6];
            int64_t lastSeenUs = 0;
            uint8_t cmdSeq = 0;
        };

        int16_t findPod(const uint8_t* mac) const;
        void sendClaim(const uint8_t* mac, uint8_t podId);

        void handleHello(const RxFrame& frame);
        void handleClaimAck(const RxFrame& frame);
        void handlePing(const RxFrame& frame, int16_t podId);
        void handlePressed(const RxFrame& frame, int16_t podId);

        EspNowLink& link = EspNowLink::get();
        uint32_t setId = 0;
        std::vector<Pod> pods;
        std::deque<PodEvent> events;
        StoreSync sync{0};
        bool syncAllowed = true;

        bool acceptNew = false;
        uint8_t maxPods = 0;

        bool claimPending = false;
        uint8_t claimMac[6];
        int64_t claimSentUs = 0;
};
