#pragma once

#include <ArduinoJson.h>

/**
 * A pod runs exactly one role (central or peripheral), chosen at boot.
 *
 * Besides run(), a role answers the role-specific part of the configuration API
 * (ConfigApi, reachable via USB serial and BLE): its status and control operations.
 */
class IRole {
    public:
        virtual ~IRole() {}

        // Called once per loop pass
        virtual void run() = 0;

        // "central" / "peripheral"
        virtual const char* name() const = 0;

        // Adds the role's state to a "status" response
        virtual void describe(JsonObject status) = 0;

        // Handles a role-specific operation. Returns false if the op is unknown.
        // The role fills the response: "ok": true + data, or ConfigApi::setError(...).
        virtual bool control(const char* op, JsonObjectConst request, JsonDocument& response) { return false; }

        // Whether program files may be changed right now (not during a game or a sync)
        virtual bool storeEditable() const { return true; }

        // Whether "validate" may load a program into the block engine right now
        virtual bool engineIdle() const { return true; }

        // Whether nothing is due before the next radio frame or button edge, so the loop may wait
        // for up to 1 ms instead of spinning (#21, timing.md §1). False during an armed activation.
        virtual bool idle() const { return false; }
};
