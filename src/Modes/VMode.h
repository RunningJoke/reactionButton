#pragma once

#include <Arduino.h>

class VMode {
    public:
        virtual void run(uint64_t timestamp) = 0;
        virtual void reset() = 0;
};