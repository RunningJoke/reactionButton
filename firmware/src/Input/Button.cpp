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
    this->lastEdgeUs = esp_timer_get_time();
    this->pressTimeUs = this->lastEdgeUs;
    this->releaseTimeUs = this->lastEdgeUs;
}

void Button::update() {
    int64_t now = esp_timer_get_time();
    bool raw = digitalRead(this->pin) == LOW; // active LOW

    if(raw == this->down || now - this->lastEdgeUs < LOCKOUT_US) {
        return;
    }

    this->down = raw;
    this->lastEdgeUs = now;
    if(raw) {
        this->presses++;
        this->pressTimeUs = now;
    } else {
        this->releaseTimeUs = now;
    }
}

void Button::simulatePress() {
    int64_t now = esp_timer_get_time();
    this->down = true;
    this->lastEdgeUs = now;
    this->presses++;
    this->pressTimeUs = now;
}
