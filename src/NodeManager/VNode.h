#pragma once

#include <Arduino.h>


class VNode {
    private:
        uint64_t lastTimePressed;
    public:
        virtual void pressed(uint64_t timestamp);

        virtual void activate(uint8_t colorId);

};