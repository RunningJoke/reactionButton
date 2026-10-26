#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Block/Block.h"
#include "Block/Value.h"
#include "Link/IPodNetwork.h"
#include "Link/HoldSession.h"

/**
 * Base of the hold blocks (charge, release): runs one CHARGE / RELEASE activation on the
 * central's own button or on a peripheral and delivers what happened as HoldEvents.
 *
 *   pod "central" (default) or a pod id (value; the central's own id also means the central)
 *
 * The central's button runs the same HoldSession code that the peripheral runs for an ARM
 * frame, so the two behave alike. A peripheral that does not exist or has an older link
 * protocol (no `hold` feature) cannot take part: startHold() returns false and the block
 * takes its timeout port at once (programs.md §7.13, §7.14).
 */
class HoldBlock : public Block {
    public:
        void exit(BlockContext& ctx) override;

    protected:
        struct HoldEvent {
            enum class Kind : uint8_t { HOLD_STARTED, RELEASED };
            Kind kind = Kind::HOLD_STARTED;
            uint8_t flags = 0;          // Protocol::RELEASED_FLAG_*
            int32_t reactionUs = 0;
            uint32_t heldMs = 0;
            uint32_t chargeMs = 0;
            int64_t atUs = 0;           // central time the event arrived (a peripheral's frame: receive time)
        };

        // Reads "pod". False for any invalid JSON type.
        bool parsePod(JsonVariantConst json, VariableManager& vars);

        // Reads the pod and starts the activation. False: the pod cannot take part.
        bool startHold(BlockContext& ctx, const ArmCommand& command);

        // Next event of this activation, false if none
        bool pollHold(BlockContext& ctx, HoldEvent& event);

        // Ends the activation. keepRing: the pod / ring keeps what it shows (the charge flash);
        // else the pod is reset / the central's ring switched off.
        void stopHold(BlockContext& ctx, bool keepRing);

        // Pod id for results: the peripheral's, or the central's own
        uint8_t resultPodId(BlockContext& ctx) const { return this->local ? ctx.centralPodId : this->podId; }

    private:
        bool podCentral = true;         // "pod" is "central" or missing
        Value pod;

        bool local = false;             // the central's own button, resolved on enter
        bool active = false;
        uint8_t podId = 0;
        uint8_t cmdSeq = 0;
        HoldSession session;
};
