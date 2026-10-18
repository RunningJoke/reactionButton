#pragma once

#include <Arduino.h>

/**
 * Debounced push button with edge counters and timestamps.
 *
 * An edge is accepted immediately (no delay for reaction timing). Further changes are
 * ignored for LOCKOUT_US to filter contact bounce.
 *
 * Consumers detect new presses by comparing pressCount() with a value they stored
 * earlier. A press that started before a block was entered therefore never counts for
 * that block. This stops a held button from leaking into the next step.
 */
class Button {
    public:
        static Button& get();

        // Samples the pin. Call once per loop pass.
        void update();

        bool isDown() const { return this->down; }
        uint32_t pressCount() const { return this->presses; }

        // esp_timer time (µs) of the last press / release edge
        int64_t lastPressTimeUs() const { return this->pressTimeUs; }
        int64_t lastReleaseTimeUs() const { return this->releaseTimeUs; }

        // Same in ms, on the millis() time base
        uint32_t lastPressTime() const { return (uint32_t)(this->pressTimeUs / 1000); }
        uint32_t lastReleaseTime() const { return (uint32_t)(this->releaseTimeUs / 1000); }

        // Duration of the most recent completed press
        uint32_t lastHeldMs() const { return (uint32_t)((this->releaseTimeUs - this->pressTimeUs) / 1000); }

    private:
        static const int64_t LOCKOUT_US = 20000;

        Button(uint8_t pin);

        uint8_t pin;
        bool down = false;
        int64_t lastEdgeUs = 0;
        uint32_t presses = 0;
        int64_t pressTimeUs = 0;
        int64_t releaseTimeUs = 0;
};
