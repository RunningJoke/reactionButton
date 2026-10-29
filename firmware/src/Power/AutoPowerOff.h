#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

/**
 * Auto power-off (#21).
 *
 * The role says whether the pod may power off (IRole::powerOffAllowed): an unclaimed peripheral, or a
 * central in the menu without a phone. While it is allowed and no button edge occurs for
 * AUTO_POWER_OFF_MINUTES (_Definitions.h), the pod shows a short goodbye (the ring drains) and enters
 * deep sleep. The button (GPIO PIN_BUTTON_PRESS, active LOW) wakes it: the wake-up is a normal boot,
 * so the boot gauge and the role choice by the button work as usual.
 *
 * A disallowed state, any button press or a connected USB host (a computer) restarts the idle time. Nothing is ever switched off during a
 * game, a set's activation or while a claimed peripheral waits for its central.
 */
class AutoPowerOff {
    public:
        // Call once per loop pass with the role's powerOffAllowed(). Returns only if the pod stays awake.
        static void service(bool allowed);

        // "powerOff" part of status: idleMs (counted as if no USB host were connected), limitMs, usbHost
        static void describe(JsonObject status);
};
