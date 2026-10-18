#pragma once

#include <Arduino.h>

/**
 * Debounced push button with edge counters and timestamps.
 *
 * An edge is accepted immediately (no delay for reaction timing). Further changes are
 * ignored for LOCKOUT_MS to filter contact bounce.
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
        uint32_t lastPressTime() const { return this->pressTime; }
        uint32_t lastReleaseTime() const { return this->releaseTime; }

        // Duration of the most recent completed press
        uint32_t lastHeldMs() const { return this->releaseTime - this->pressTime; }

    private:
        static const uint32_t LOCKOUT_MS = 20;

        Button(uint8_t pin);

        uint8_t pin;
        bool down = false;
        uint32_t lastEdge = 0;
        uint32_t presses = 0;
        uint32_t pressTime = 0;
        uint32_t releaseTime = 0;
};
