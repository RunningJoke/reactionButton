#pragma once

#include <Arduino.h>

namespace RandomUtil {

    // Uniform random number in [low, high] (inclusive). Negative ranges give 0.
    inline int64_t between(int64_t low, int64_t high) {
        if(low < 0) low = 0;
        if(high <= low) {
            return low;
        }
        return low + (int64_t)(esp_random() % (uint32_t)(high - low + 1));
    }

    // Uniform random number in [0, count)
    inline int64_t below(int64_t count) {
        return count <= 1 ? 0 : (int64_t)(esp_random() % (uint32_t)count);
    }
}
