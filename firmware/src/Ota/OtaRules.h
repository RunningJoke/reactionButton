#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <strings.h>
#include <string.h>

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
}
