#include "SystemPattern.h"
#include <math.h>
#include <string.h>
#include "LEDManager/LEDManager.h"
#include "LEDManager/Identity.h"

namespace SystemPattern {

namespace {
    const char* const NAMES[] = {
        "none", "boot", "search", "joined", "discovery", "ready", "select", "selectCancel", "selected", "paused",
        "lowBattery", "sleep", "menu"
    };
    static_assert(sizeof(NAMES) / sizeof(NAMES[0]) == (size_t)Id::COUNT_, "one name per pattern");

    const uint32_t BREATHE_GREEN_MS = 2200;
    const uint32_t BREATHE_AMBER_MS = 2600;
    const float BREATHE_FLOOR = 0.15f;          // breathing never goes dark: dark means off
    const uint32_t BOUNCE_WAY_MS = 2000;
    const float BOUNCE_TAIL = 3.0f;             // LEDs behind the spot
    const uint32_t JOINED_FLASH_MS = 225;       // two flashes: on, off, on, off
    const float JOINED_DIM = 0.3f;
    const float MARKER_DIM = 0.25f;
    const float LOW_BATTERY_DIM = 0.05f;
    // boot gauge: blue-cyan at 60 % perceived (~36 % duty), so it reads clearly against the full white timer;
    // SYSTEM_LEVEL halves both, which alone left them looking the same on the LEDs
    const ColorSet GAUGE = {0, 70, 255};
    const float GAUGE_LEVEL = 0.6f;
    const uint32_t LOW_BATTERY_ON_MS = 200;

    inline uint8_t toLevel(float k) {
        return k <= 0.0f ? 0 : k >= 1.0f ? 255 : (uint8_t)(k * 255.0f + 0.5f);
    }

    // cubic ease-out, 0 ... 1
    inline float ease(float x) {
        x = x < 0.0f ? 0.0f : x > 1.0f ? 1.0f : x;
        float r = 1.0f - x;
        return 1.0f - r * r * r;
    }

    // floor ... 1 ... floor, raised cosine, starts at the floor
    inline float breathe(uint32_t t, uint32_t period) {
        float phase = (float)(t % period) / (float)period;
        return BREATHE_FLOOR + (1.0f - BREATHE_FLOOR) * (0.5f - 0.5f * cosf(2.0f * (float)M_PI * phase));
    }

    inline void set(Pixel& p, const ColorSet& color, float k) {
        p.color = color;
        p.level = toLevel(k);
        p.snapshot = false;
    }

    void fill(Pixel* out, const ColorSet& color, float k) {
        for(uint8_t i = 0; i < LEDS; i++) {
            set(out[i], color, k);
        }
    }

    ColorSet podColor(uint8_t podId) {
        ColorSet c = {0, 0, 0};
        LEDManager::colorOf(Identity::colorOf(podId), c);
        return c;
    }

    // amber spot bouncing over LEDs SEARCH_FIRST ... 17, reversing at the ends, tail behind it
    void bounce(Pixel* out, uint32_t t) {
        float u = (float)(t % (2 * BOUNCE_WAY_MS)) / (float)BOUNCE_WAY_MS;
        bool forward = u <= 1.0f;
        float pos = SEARCH_FIRST + (forward ? u : 2.0f - u) * (float)(LEDS - 1 - SEARCH_FIRST);
        for(uint8_t j = SEARCH_FIRST; j < LEDS; j++) {
            float d = forward ? pos - j : j - pos;
            if(d > -0.6f && d < BOUNCE_TAIL) {
                set(out[j], *AMBER, 1.0f - (d > 0.0f ? d : 0.0f) / BOUNCE_TAIL);
            }
        }
    }

    // white fill of SELECT at `p` LEDs over the snapshot shown at `rest` (the head lights where the snapshot is dark)
    void whiteFill(Pixel* out, float p, uint8_t rest) {
        for(uint8_t i = 0; i < LEDS; i++) {
            if(i + 1 <= p) {
                set(out[i], *WHITE, 1.0f);
            } else {
                out[i].snapshot = true;
                out[i].color = i < p ? *WHITE : ColorSet{0, 0, 0};
                out[i].level = rest;
            }
        }
    }
}

uint32_t durationMs(Id id, const Args& args)
{
    switch(id) {
        case Id::BOOT: return BOOT_MS;
        case Id::SELECT: return SELECT_MS;
        case Id::SELECT_CANCEL: return args.fillMs;
        case Id::SELECTED: return SELECTED_MS;
        case Id::SLEEP: return SLEEP_MS;
        default: return 0;
    }
}

bool render(Id id, const Args& args, uint32_t t, Pixel out[LEDS])
{
    const ColorSet off = {0, 0, 0};
    fill(out, off, 0.0f);

    uint32_t length = durationMs(id, args);
    bool ended = length != 0 && t >= length;

    switch(id) {
        case Id::BOOT:
        {
            bool known = args.percent <= 100;
            float charge = known ? args.percent / 100.0f : 1.0f;
            const ColorSet& gaugeColor = known && args.percent < LOW_PERCENT_GAUGE ? *AMBER : GAUGE;
            if(ended) {
                fill(out, *WHITE, 1.0f);
                break;
            }
            if(t < BOOT_GAUGE_MS) {
                uint8_t n = (uint8_t)lroundf(LEDS * charge * ease((float)t / BOOT_GAUGE_FILL_MS));
                for(uint8_t i = 0; i < n && i < LEDS; i++) {
                    set(out[i], gaugeColor, GAUGE_LEVEL);
                }
                break;
            }
            uint8_t gauge = (uint8_t)lroundf(LEDS * charge);
            float p = (float)(t - BOOT_GAUGE_MS) * LEDS / (float)(BOOT_MS - BOOT_GAUGE_MS);
            for(uint8_t i = 0; i < LEDS; i++) {
                if(i < p) {
                    set(out[i], *WHITE, 1.0f);
                } else if(i < gauge) {
                    set(out[i], gaugeColor, GAUGE_LEVEL);
                }
            }
            break;
        }
        case Id::SEARCH:
            bounce(out, t);
            break;

        case Id::JOINED:
        {
            // pod n = n LEDs (owner decision, #82)
            bool flashing = t < 4 * JOINED_FLASH_MS;
            float k = !flashing ? JOINED_DIM : (t / JOINED_FLASH_MS) % 2 == 0 ? 1.0f : 0.0f;
            for(uint8_t i = 0; i < Identity::numberOf(args.podId) && i < SEARCH_FIRST; i++) {
                set(out[i], podColor(args.podId), k);
            }
            if(flashing) {
                break;
            }
            float g = breathe(t - 4 * JOINED_FLASH_MS, BREATHE_GREEN_MS);
            for(uint8_t j = SEARCH_FIRST; j < LEDS; j++) {
                set(out[j], *GREEN, g);
            }
            break;
        }
        case Id::DISCOVERY:
            for(uint8_t i = 0; i < args.wanted && i < SEARCH_FIRST; i++) {
                set(out[Identity::ledOf(i)], podColor(i), i < args.found ? 1.0f : MARKER_DIM);
            }
            bounce(out, t);
            break;

        case Id::READY:
            fill(out, *GREEN, breathe(t, BREATHE_GREEN_MS));
            break;

        case Id::PAUSED:
            fill(out, *AMBER, breathe(t, BREATHE_AMBER_MS));
            break;

        case Id::SELECT:
            // the snapshot is the MENU pattern's frame, already at system brightness
            whiteFill(out, ended ? LEDS : (float)t * LEDS / SELECT_MS, 255);
            break;

        case Id::SELECT_CANCEL:
            // the snapshot is the menu just redrawn at full brightness
            whiteFill(out, ended ? 0.0f : (float)(args.fillMs - t) * LEDS / SELECT_MS, SNAPSHOT_SYSTEM);
            break;

        case Id::SELECTED:
        {
            bool on = (t < 150) || (t >= 300 && t < 450);
            if(on && !ended) {
                fill(out, *WHITE, 1.0f);
            }
            break;
        }
        case Id::LOW_BATTERY:
            set(out[LOW_BATTERY_LED], *AMBER, t % 1000 < LOW_BATTERY_ON_MS ? 1.0f : LOW_BATTERY_DIM);
            break;

        case Id::SLEEP:
        {
            if(ended) {
                break;
            }
            uint8_t n = LEDS - (uint8_t)lroundf(LEDS * ease((float)t / SLEEP_DRAIN_MS));
            float k = 1.0f - (float)t / SLEEP_MS;
            for(uint8_t i = 0; i < n; i++) {
                set(out[i], *WHITE, k);
            }
            break;
        }
        case Id::MENU:
        {
            uint8_t level = args.breathing ? toLevel(breathe(t, BREATHE_GREEN_MS) * SNAPSHOT_SYSTEM / 255.0f)
                                           : SNAPSHOT_SYSTEM;
            for(uint8_t i = 0; i < LEDS; i++) {
                out[i].snapshot = true;
                out[i].level = level;
            }
            break;
        }
        default:
            break;
    }
    return ended;
}

const char* name(Id id)
{
    return (uint8_t)id < (uint8_t)Id::COUNT_ ? NAMES[(uint8_t)id] : nullptr;
}

Id fromName(const char* name)
{
    for(uint8_t i = 0; i < (uint8_t)Id::COUNT_; i++) {
        if(strcmp(NAMES[i], name) == 0) {
            return (Id)i;
        }
    }
    return Id::COUNT_;
}

}
