#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

/**
 * Crash diagnostics without a debugger or UART: code marks the step it is in
 * (Diag::step). The mark lives in RTC memory, which survives a panic reboot. After
 * an abnormal reset the boot report names the reset reason and the last step reached.
 */
namespace Diag {
    // Marks the current step (short text, copied)
    void step(const char* name);

    // Call once at boot: reads the previous mark and reset reason, then clears the mark
    void begin();

    // {"reason": "...", "lastStep": "..."} of the previous reset
    void describe(JsonObject out);

    // true if the previous reset was a panic / watchdog / brownout
    bool lastResetWasAbnormal();
}
