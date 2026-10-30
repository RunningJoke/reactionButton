#pragma once

#include <stdint.h>
#include "ColorSet/ColorSet.h"

/**
 * System patterns: the firmware's own ring signals outside a game (light language, #82, fw >= 2.15).
 * Firmware only: never sent over the link and not usable from programs (no EffectId, no program format).
 *
 * Like an effect, a pattern is a pure function of the time since its start (render()). LEDManager::playPattern
 * plays it; every static call, effect or other pattern takes the ring over. Timings and colours follow the
 * Light lab board (docs/firmware/architecture.md §7.1):
 *
 *   BOOT          battery gauge (cyan, amber below 20 %; full cyan without a reading) fills with ease-out in
 *                 0.5 s and holds until 1 s, then white fills the ring as the role timer (1.6 s). Ends full white
 *   SEARCH        amber spot with a tail bouncing over LEDs 8 ... 17, 2 s per way (looking for its set / pods)
 *   JOINED        pod `podId`: its LED flashes twice (225 ms), then stays dim; LEDs 8 ... 17 breathe green
 *   DISCOVERY     LEDs 0 ... wanted-1: dim marker per wanted pod in its colour, bright once found; SEARCH on 8 ... 17
 *   READY         whole ring breathes green (all pods here: press to start)
 *   SELECT        white fills the ring clockwise over the snapshot (program menu held), 1.6 s, ends full white
 *   SELECT_CANCEL white drains back from `fillMs` of SELECT to the snapshot at the same speed
 *   SELECTED      two white flashes of the whole ring, then dark (700 ms)
 *   PAUSED        whole ring breathes amber
 *   LOW_BATTERY   LED 9 alone, amber, 200 ms on per second, dim in between
 *   SLEEP         white drains anticlockwise with ease-out (1.6 s) while dimming to dark (2 s)
 *
 * "Snapshot" = the ring as it was when the pattern started (LEDManager keeps it).
 */
namespace SystemPattern {

    enum class Id : uint8_t {
        NONE = 0, BOOT, SEARCH, JOINED, DISCOVERY, READY, SELECT, SELECT_CANCEL, SELECTED, PAUSED, LOW_BATTERY, SLEEP,
        COUNT_
    };

    struct Args {
        uint8_t percent = 255;      // BOOT: battery percent, 255 = unknown
        uint8_t podId = 0;          // JOINED: own pod id (LED and colour, Identity)
        uint8_t wanted = 0;         // DISCOVERY: pods the program needs
        uint8_t found = 0;          // DISCOVERY: pods claimed (ids 0 ... found-1, ids go in claim order)
        uint16_t fillMs = 0;        // SELECT_CANCEL: how long SELECT had filled when the button was let go
    };

    // One LED of a frame: `color` at perceived brightness `level` (0 ... 255, gamma applied by LEDManager),
    // or the snapshot (`snapshot` true); with `snapshot` and `level` > 0, white at `level` where the snapshot
    // is dark (SELECT's head)
    struct Pixel {
        ColorSet color;
        uint8_t level;
        bool snapshot;
    };

    const uint8_t LEDS = 18;

    // Lengths (ms)
    const uint32_t BOOT_MS = 2600;              // gauge 1 s + timer 1.6 s: the role is read at the end
    const uint32_t BOOT_GAUGE_MS = 1000;
    const uint32_t BOOT_GAUGE_FILL_MS = 500;
    const uint32_t SELECT_MS = 1600;
    const uint32_t SELECTED_MS = 700;
    const uint32_t SLEEP_MS = 2000;
    const uint32_t SLEEP_DRAIN_MS = 1600;
    const uint8_t LOW_PERCENT_GAUGE = 20;       // BOOT: amber below

    const uint8_t SEARCH_FIRST = 8;             // LEDs 0 ... 7 are reserved for pod markers / the own number
    const uint8_t LOW_BATTERY_LED = 9;

    // Length of a pattern in ms, 0 = endless
    uint32_t durationMs(Id id, const Args& args);

    // Frame at `elapsedMs` since the start. Returns true when the pattern has ended (this is its last frame).
    bool render(Id id, const Args& args, uint32_t elapsedMs, Pixel out[LEDS]);

    // JSON name ("boot", "search", ...) for the test op; nullptr / COUNT_ if unknown
    const char* name(Id id);
    Id fromName(const char* name);
}
