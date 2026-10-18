#pragma once

#include <Arduino.h>
#include "Roles/IRole.h"
#include "Link/EspNowLink.h"
#include "Link/ClockSync.h"
#include "Link/Protocol.h"
#include "Store/StoreSync.h"

/**
 * PERIPHERAL role.
 *
 *   UNCLAIMED  yellow. Broadcasts HELLO every 250 ms until a central of its set (or any
 *              central, if unpaired) claims it. Holding the button 3 s clears the pairing.
 *   READY      off. Sends PING every 200 ms (heartbeat + clock sync).
 *   SCHEDULED  armed with a start time; lights up when the synchronised clock reaches it.
 *   ACTIVE     lit, waiting for a press. The reaction time is measured locally from the
 *              moment the LEDs were updated to the button edge.
 *   DONE       pressed and reported, waiting for RESET or the next ARM.
 *
 * Without PONG from the central for 2 s the pod goes back to UNCLAIMED and can be
 * claimed again (e.g. after a central reboot).
 *
 * While claimed, the program store is synchronised with the central (StoreSync), so
 * every pod of a set has all programs and can be the central next time.
 */
class PeripheralRole : public IRole {
    public:
        PeripheralRole();
        void run() override;

    private:
        enum class State : uint8_t { UNCLAIMED, READY, SCHEDULED, ACTIVE, DONE };

        static const int64_t HELLO_INTERVAL_US = 250000;
        static const int64_t PING_INTERVAL_US = 200000;
        static const int64_t CENTRAL_TIMEOUT_US = 2000000;
        static const int64_t PAIR_RESET_HOLD_US = 3000000;

        void handleFrame(const RxFrame& frame);
        void handleClaim(const RxFrame& frame);
        void handleArm(const Protocol::Arm& arm);
        void activate();
        void becomeUnclaimed();
        void sendPing();

        EspNowLink& link = EspNowLink::get();
        ClockSync clock;
        StoreSync sync{0};
        State state = State::UNCLAIMED;

        uint32_t setId = 0;
        uint8_t centralMac[6];
        uint8_t podId = 0;

        int64_t lastHelloUs = 0;
        int64_t lastPingUs = 0;
        int64_t lastPongUs = 0;
        bool pairResetDone = false;

        // current activation
        uint8_t cmdSeq = 0;
        Protocol::PodMode mode = Protocol::PodMode::HIT;
        uint8_t colorActive = Protocol::Color::GREEN;
        uint8_t colorAfter = Protocol::Color::OFF;
        int64_t scheduledLocalUs = 0;
        int64_t activatedUs = 0;
        uint32_t pressCountAtActivation = 0;
};
