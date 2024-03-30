#pragma once

#include <Arduino.h>

class VPod {
    public:
        virtual void start() = 0;
        virtual void stop() = 0;
        virtual int8_t update(uint64_t timestamp) = 0;
};