#pragma once

#include <Arduino.h>
#include "Roles/IRole.h"
#include "Link/EspNowLink.h"
#include "Link/ClockSync.h"
#include "Link/Protocol.h"
#include "Link/HoldSession.h"
#include "Store/StoreSync.h"

/**
 * PERIPHERAL role.
 *
 *   UNCLAIMED  SEARCH pattern (light language, #82). Broadcasts HELLO every 250 ms until a central of
 *              its set (or any central, if unpaired) claims it. Holding the button 3 s clears the pairing.
 *   READY      off. Sends PING every 200 ms (heartbeat + clock sync).
 *   SCHEDULED  armed with a start time; lights up when the synchronised clock reaches it.
 *   ACTIVE     lit (colorActive, or the ARM's waiting effect), waiting for a press. The
 *              reaction time is measured locally from the moment the LEDs were updated to
 *              the button edge.
 *   HOLDING    armed for a CHARGE / RELEASE activation (HoldSession): measures the hold, shows
 *              it on the ring and reports PRESSED (hold start) and RELEASED.
 *              A TOGGLE activation stays ACTIVE: every press flips the colour between team A and B
 *              (runToggle) and reports PRESSED with the owner, until RESET or the next ARM.
 *   DONE       pressed and reported, waiting for RESET or the next ARM.
 *   UPDATE     firmware update from the central (#130): OTA_OFFER starts it, the image is pulled with SYNC_READ "@ota"
 *              (or heard as OTA_CHUNK broadcasts) into the inactive slot (Ota::radio*). The pod keeps pinging, shows the
 *              progress and ignores games. It ends with OTA_ACTIVATE (restart) or when the PONGs lose PONG_FLAG_OTA
 *              (the central aborted: discard, READY). Link-protocol.md section 5.3.
 *
 * EFFECT frames play an effect on the ring in any claimed state; they do not change the
 * state. Effect start times are converted to the local clock with ClockSync.
 *
 * Identity (LEDManager/Identity.h, SystemPattern JOINED): a READY pod shows its number (JOINED) for a short
 * time after the claim, and keeps it while the central is in the menu, discovery or confirm
 * (PONG_FLAG_IDENTIFY); otherwise it is dark. A low battery replaces it with LOW_BATTERY. An EFFECT
 * (the central's blink) takes the ring for its length; the identity comes back afterwards.
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

        const char* name() const override { return "peripheral"; }
        void describe(JsonObject status) override;
        bool control(const char* op, JsonObjectConst request, JsonDocument& response) override;
        bool storeEditable() const override;
        // UNCLAIMED and READY: no activation is armed, so a press or a frame is seen within 1 ms
        bool idle() const override { return this->state == State::UNCLAIMED || this->state == State::READY; }
        // only unclaimed: a claimed pod belongs to a set and stays awake for its central
        bool powerOffAllowed() const override { return this->state == State::UNCLAIMED; }
        // not in a game: unclaimed or claimed and waiting
        bool otaAllowed() const override { return this->state == State::UNCLAIMED || this->state == State::READY; }
        // the update ignored the central: start over, becoming unclaimed shows the SEARCH ring. An update from the central
        // (UPDATE) only ends the failure blink: the pod stays in its set.
        void otaEnded() override;

    private:
        enum class State : uint8_t { UNCLAIMED, READY, SCHEDULED, ACTIVE, HOLDING, DONE, UPDATE };
        enum class IdentityShow : uint8_t { NONE, JOINED, LOW_BATTERY };

        static const int64_t HELLO_INTERVAL_US = 250000;
        static const int64_t PING_INTERVAL_US = 200000;
        static const int64_t CENTRAL_TIMEOUT_US = 2000000;
        static const int64_t PAIR_RESET_HOLD_US = 3000000;
        static const int64_t CLAIM_JOINED_US = 1500000;     // JOINED after a claim, then the identify flag decides

        void handleFrame(const RxFrame& frame);
        void handleClaim(const RxFrame& frame);
        void handleArm(const RxFrame& frame);
        void handleEffect(const Protocol::Effect& effect);
        int64_t localStartUs(int64_t centralUs) const;
        void activate();
        void runHold();
        void runToggle();
        void showToggleOwner();
        void handleOffer(const RxFrame& frame);
        void handleOtaChunk(const RxFrame& frame);
        bool handleOtaResponse(const RxFrame& frame);
        void handleOtaActivate(const RxFrame& frame);
        void runUpdate(int64_t now);
        void leaveUpdate();
        uint8_t otaPingState() const;
        void becomeUnclaimed();
        void showUnclaimed();
        void updateIdentity(int64_t now);
        void sendPing();
        static const char* stateName(State state);

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

        // identity display (see the class comment)
        bool identifyWanted = false;                // PONG_FLAG_IDENTIFY of the last PONG
        int64_t claimJoinedUntilUs = 0;             // JOINED after a claim until then
        int64_t identityBlockedUntilUs = 0;         // an EFFECT from the central owns the ring until then
        IdentityShow identityShown = IdentityShow::NONE;

        // firmware update from the central (UPDATE)
        static const int64_t OTA_REQUEST_TIMEOUT_US = 300000;
        static const uint8_t OTA_MAX_RETRIES = 5;
        bool otaBroadcast = false;                  // the offer announced a broadcast pass: pull only when PONG_FLAG_OTA_PULL says so
        bool otaPullAllowed = false;                // PONG_FLAG_OTA_PULL of the last PONG
        bool otaPreparing = false;                  // erasing the slot
        bool otaLowBattery = false;                 // refused an offer
        int32_t otaRequested = -1;                  // chunk of the request in flight
        uint8_t otaReqId = 0;
        uint8_t otaRetries = 0;
        int64_t otaRequestUs = 0;
        int64_t otaPauseUntilUs = 0;
        uint16_t otaCursor = 0;                     // where the search for a missing chunk goes on

        // current activation
        uint8_t cmdSeq = 0;
        Protocol::PodMode mode = Protocol::PodMode::HIT;
        uint8_t colorActive = Protocol::Color::GREEN;
        uint8_t colorAfter = Protocol::Color::OFF;
        int64_t scheduledLocalUs = 0;
        bool hasWaitingEffect = false;
        Protocol::EffectDesc waitingEffect;
        int64_t waitingEffectStartUs = 0;      // local; 0 = at activation
        int64_t activatedUs = 0;
        uint32_t pressCountAtActivation = 0;
        ArmCommand holdCommand;                 // CHARGE / RELEASE activation
        HoldSession hold;

        // TOGGLE activation: colorActive is team A, colorAfter team B
        uint8_t toggleOwner = Protocol::OWNER_NONE;
        uint16_t toggleFlips = 0;
        int64_t toggleCooldownUs = 0;
        int64_t toggleLastFlipUs = 0;           // button time of the last accepted press
        int64_t toggleEffectStartUs = 0;        // local start of the countdown, kept across flips
};
