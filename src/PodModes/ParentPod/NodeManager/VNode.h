#pragma once

#include <Arduino.h>


class VNode {
    protected:
        uint64_t lastTimePressed;
        bool wasPressed;
    public:
        virtual void pressed(uint64_t timestamp) = 0;

        virtual void activate(const char* activationCode) = 0;
        virtual void deactivate() = 0;

        virtual bool isPressed() = 0;

};