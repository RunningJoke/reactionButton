#pragma once

#include <Arduino.h>

/**
 * Estimates the offset between the central's clock and the local clock from PING/PONG
 * round trips (NTP method):
 *
 *   offset = ((t2 - t1) + (t3 - t4)) / 2      central = local + offset
 *   delay  = (t4 - t1) - (t3 - t2)            round trip on air
 *
 * t1/t4 are local (PING sent / PONG received), t2/t3 central (PING received / PONG sent).
 * The sample with the smallest delay of the last WINDOW samples is used, because its
 * offset has the smallest error from queueing and retransmissions.
 */
class ClockSync {
    public:
        void addSample(int64_t t1, int64_t t2, int64_t t3, int64_t t4) {
            int64_t delay = (t4 - t1) - (t3 - t2);
            if(delay < 0) {
                return;
            }
            Sample& s = this->samples[this->next];
            s.offset = ((t2 - t1) + (t3 - t4)) / 2;
            s.delay = delay;
            this->next = (this->next + 1) % WINDOW;
            if(this->count < WINDOW) {
                this->count++;
            }
        }

        bool isSynced() const { return this->count > 0; }

        int64_t offset() const {
            int64_t bestDelay = INT64_MAX;
            int64_t best = 0;
            for(uint8_t i = 0; i < this->count; i++) {
                if(this->samples[i].delay < bestDelay) {
                    bestDelay = this->samples[i].delay;
                    best = this->samples[i].offset;
                }
            }
            return best;
        }

        // Converts a central timestamp to the local esp_timer clock
        int64_t toLocal(int64_t centralUs) const { return centralUs - this->offset(); }

        void clear() { this->count = 0; this->next = 0; }

    private:
        enum { WINDOW = 8 };

        struct Sample {
            int64_t offset;
            int64_t delay;
        };

        Sample samples[WINDOW];
        uint8_t count = 0;
        uint8_t next = 0;
};
