#include "Button.h"
#include "_Definitions.h"

Button& Button::get() {
    static Button button(PIN_BUTTON_PRESS);
    return button;
}

Button::Button(uint8_t pin) {
    this->pin = pin;
    // treat a button held at construction as "already pressed" so it never counts as a new press
    this->down = digitalRead(pin) == LOW;
    this->lastEdge = millis();
}

void Button::update() {
    uint32_t now = millis();
    bool raw = digitalRead(this->pin) == LOW; // active LOW

    if(raw == this->down || now - this->lastEdge < LOCKOUT_MS) {
        return;
    }

    this->down = raw;
    this->lastEdge = now;
    if(raw) {
        this->presses++;
        this->pressTime = now;
    } else {
        this->releaseTime = now;
    }
}
