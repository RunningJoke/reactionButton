#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <strings.h>
#include <string.h>
#include "Link/Protocol.h"

/**
 * The rules of a firmware update over the config API (#123, docs/firmware/config-api.md "Firmware update"),
 * free of ESP headers so that the native tests run them (test/test_ota).
 */
namespace OtaRules {

    enum class State : uint8_t { IDLE, RECEIVING, VERIFYING, READY, FAILED };

    const uint8_t MIN_BATTERY_PERCENT = 30;
    const uint32_t TIMEOUT_MS = 10UL * 60 * 1000;      // an update without a chunk for this long is discarded

    inline const char* stateName(State state) {
        switch(state) {
            case State::IDLE: return "idle";
            case State::RECEIVING: return "receiving";
            case State::VERIFYING: return "verifying";
            case State::READY: return "ready";
            case State::FAILED: return "failed";
        }
        return "?";
    }

    // The pod is set up for an update that has begun and is not over: no power-off, no program selection
    inline bool inProgress(State state) {
        return state == State::RECEIVING || state == State::VERIFYING || state == State::READY;
    }

    enum class WriteCheck : uint8_t { OK, NOT_RECEIVING, EMPTY, BAD_OFFSET, TOO_LARGE };

    // An otaWrite of `length` raw bytes at `offset`
    inline WriteCheck checkWrite(State state, uint32_t received, uint32_t total, uint32_t offset, size_t length) {
        if(state != State::RECEIVING) return WriteCheck::NOT_RECEIVING;
        if(length == 0) return WriteCheck::EMPTY;
        if(offset != received) return WriteCheck::BAD_OFFSET;
        if((uint64_t)offset + length > total) return WriteCheck::TOO_LARGE;
        return WriteCheck::OK;
    }

    // 64 hexadecimal characters
    inline bool isSha256Hex(const char* text) {
        if(text == nullptr || strlen(text) != 64) return false;
        for(size_t i = 0; i < 64; i++) {
            char c = text[i];
            if(!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
        }
        return true;
    }

    // `hex` (64 characters, any case) spells `digest`
    inline bool hexMatches(const char* hex, const uint8_t digest[32]) {
        if(!isSha256Hex(hex)) return false;
        for(size_t i = 0; i < 32; i++) {
            char pair[3] = {hex[2 * i], hex[2 * i + 1], 0};
            if(strtoul(pair, nullptr, 16) != digest[i]) return false;
        }
        return true;
    }

    // `hex` (64 characters) as 32 bytes; false if it is not a SHA-256 text
    inline bool hexToBytes(const char* hex, uint8_t out[32]) {
        if(!isSha256Hex(hex)) return false;
        for(size_t i = 0; i < 32; i++) {
            char pair[3] = {hex[2 * i], hex[2 * i + 1], 0};
            out[i] = (uint8_t)strtoul(pair, nullptr, 16);
        }
        return true;
    }

    // 32 bytes as 64 lower case hexadecimal characters and a terminator
    inline void bytesToHex(const uint8_t in[32], char out[65]) {
        const char* digits = "0123456789abcdef";
        for(size_t i = 0; i < 32; i++) {
            out[2 * i] = digits[in[i] >> 4];
            out[2 * i + 1] = digits[in[i] & 15];
        }
        out[64] = '\0';
    }

    // otaBegin continues the open update instead of starting a new one: same size and hash, not discarded
    inline bool resumes(State state, uint32_t openSize, const char* openHex, uint32_t size, const char* hex) {
        return (state == State::RECEIVING || state == State::READY) && openSize == size
            && strcasecmp(openHex, hex) == 0;
    }

    // below 30 % no update; a pod with no reading is allowed
    inline bool batteryAllows(bool known, uint8_t percent) {
        return !known || percent >= MIN_BATTERY_PERCENT;
    }

    // `nowMs` and `lastMs` are millis() values (wrap-safe)
    inline bool expired(uint32_t nowMs, uint32_t lastMs) {
        return (uint32_t)(nowMs - lastMs) >= TIMEOUT_MS;
    }

    inline uint8_t percent(uint32_t received, uint32_t total) {
        return total == 0 ? 0 : (uint8_t)((uint64_t)received * 100 / total);
    }

    // --- distribution to the peripherals (#130, #131) ---

    // The state of a pod in status.ota.pods[]. `wire` is the pod's PING otaState; `current` = it already runs the
    // offered version, `supported` = it has LINK_FEATURE_OTA, `alive` = it answered lately.
    inline const char* podStateName(uint8_t wire, bool alive, bool current, bool supported) {
        if(!supported) return "failed";
        if(current) return "current";
        if(!alive) return "offline";
        switch(wire) {
            case Protocol::OTA_POD_NONE: return "queued";
            case Protocol::OTA_POD_PREPARING: return "transferring";
            case Protocol::OTA_POD_RECEIVING: return "transferring";
            case Protocol::OTA_POD_READY: return "ready";
            case Protocol::OTA_POD_FAILED: return "failed";
            case Protocol::OTA_POD_LOW_BATTERY: return "refused";
        }
        return "?";
    }

    // otaActivate {"force":true} may leave pods behind only when old and new firmware speak the same link
    // protocol (link-protocol.md section 7). 0 = the new one is not known (otaBegin without linkProtocol).
    inline bool forceAllowed(uint8_t newLinkProtocol, uint8_t runningLinkProtocol) {
        return newLinkProtocol != 0 && newLinkProtocol == runningLinkProtocol;
    }

    // Bar of the central: the mean of the pods' percents (a pod that needs nothing counts 100); 100 without pods
    inline uint8_t overallPercent(uint32_t percentSum, uint32_t pods) {
        return pods == 0 ? 100 : (uint8_t)(percentSum / pods);
    }
}
