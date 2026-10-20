#include "LEDManager.h"

using Protocol::EffectDesc;
using Protocol::EffectId;

LEDManager* LEDManager::manager = nullptr;

LEDManager* LEDManager::getManager() {
    if(LEDManager::manager == nullptr) {
        ESP_LOGI("LEDMANAGER", "Initializing LED manager");
        LEDManager::manager = new LEDManager(LED_PIN);
    }
    return LEDManager::manager;
}

LEDManager::LEDManager(uint8_t neoPixelPin)
{
    this->pOffConfiguration = new ColorSet{0,0,0};
    this->neoPixelPin = neoPixelPin;

    this->pixelManager = new Adafruit_NeoPixel(NEOPIXEL_SIZE, neoPixelPin, NEO_GRB + NEO_KHZ800);
    this->pixelManager->begin();
}

uint32_t LEDManager::scaled(const ColorSet& color, uint8_t level) const
{
    uint32_t s = (uint32_t)level * this->cap;      // 0 .. 255*255
    return Adafruit_NeoPixel::Color(
        (uint8_t)((color.red * s + 32512) / 65025),
        (uint8_t)((color.green * s + 32512) / 65025),
        (uint8_t)((color.blue * s + 32512) / 65025));
}

bool LEDManager::colorOf(uint8_t colorId, ColorSet& out)
{
    switch(colorId) {
        case 0: out = ColorSet{255, 0, 0}; return true;
        case 1: out = ColorSet{0, 255, 0}; return true;
        case 2: out = ColorSet{0, 0, 255}; return true;
        case 3: out = ColorSet{255, 255, 0}; return true;
        case 4: out = ColorSet{255, 0, 255}; return true;
        case 5: out = ColorSet{0, 255, 255}; return true;
        case 6: out = ColorSet{255, 255, 255}; return true;
        case 255: out = ColorSet{0, 0, 0}; return true;
    }
    return false;
}

void LEDManager::setLEDColors(uint8_t colorId)
{
    this->stopEffect();
    switch(colorId) {
        case 0: this->setLEDColors(RED); break;
        case 1: this->setLEDColors(GREEN); break;
        case 2: this->setLEDColors(BLUE); break;
        case 3: this->setLEDColors(YELLOW); break;
        case 4: this->setLEDColors(MAGENTA); break;
        case 5: this->setLEDColors(CYAN); break;
        case 6: this->setLEDColors(WHITE); break;
        case 255: this->setLEDColors(BLACK); break;
    }
}

void LEDManager::setLEDColors(ColorSet* pNewColorSet)
{
    this->stopEffect();
    this->pCurrentColorConfiguration = pNewColorSet;

    uint32_t color = this->scaled(*pNewColorSet, 255);
    for(int i=0; i<NEOPIXEL_SIZE; i++) {
         this->pixelManager->setPixelColor(i, color);
    }
    this->pixelManager->show();
}

void LEDManager::setLEDColors(uint8_t index, ColorSet* pNewColorSet)
{
    this->stopEffect();
    if(index < NEOPIXEL_SIZE) {
        this->pixelManager->setPixelColor(index, this->scaled(*pNewColorSet, 255));
        this->pixelManager->show();
    }
}

void LEDManager::setLEDColors(LEDPattern* pattern)
{
    this->stopEffect();
    if(pattern->animation != nullptr) {
        pattern->animation->animate(millis());
    }

    for(int i=0; i<NEOPIXEL_SIZE; i++) {
        uint8_t paletteId = pattern->ids->getPaletteID(i);
        this->pixelManager->setPixelColor(i, this->scaled(*pattern->palette[paletteId], 255));
    }
    this->pixelManager->show();
}

void LEDManager::turnOff()
{
    this->setLEDColors(this->pOffConfiguration);
}

// ---------------------------------------------------------------- effect player

namespace {
    // Indexed by EffectId
    const char* const EFFECT_NAMES[] = {
        "none", "solid", "fill", "drain", "dim", "colorShift", "trafficLight", "blink", "pulse", "spin", "level"
    };
    static_assert(sizeof(EFFECT_NAMES) / sizeof(EFFECT_NAMES[0]) == (size_t)EffectId::COUNT_,
                  "one name per effect");

    // LED of the k-th step around the ring, starting at LED 0
    inline uint8_t ringPos(uint8_t k, bool reverse) {
        k %= NEOPIXEL_SIZE;
        return reverse ? (uint8_t)((NEOPIXEL_SIZE - k) % NEOPIXEL_SIZE) : k;
    }

    // first n steps "on", the rest "off"
    void bar(uint32_t* out, uint8_t n, uint32_t on, uint32_t off, bool reverse) {
        for(uint8_t k = 0; k < NEOPIXEL_SIZE; k++) {
            out[ringPos(k, reverse)] = k < n ? on : off;
        }
    }

    void fillAll(uint32_t* out, uint32_t color) {
        for(uint8_t i = 0; i < NEOPIXEL_SIZE; i++) {
            out[i] = color;
        }
    }
}

const char* LEDManager::effectName(EffectId id)
{
    return (uint8_t)id < (uint8_t)EffectId::COUNT_ ? EFFECT_NAMES[(uint8_t)id] : nullptr;
}

EffectId LEDManager::effectFromName(const char* name)
{
    for(uint8_t i = 0; i < (uint8_t)EffectId::COUNT_; i++) {
        if(strcmp(EFFECT_NAMES[i], name) == 0) {
            return (EffectId)i;
        }
    }
    return EffectId::COUNT_;
}

bool LEDManager::playEffect(const EffectDesc& effect, int64_t startUs)
{
    if((uint8_t)effect.effect >= (uint8_t)EffectId::COUNT_) {
        return false;
    }
    if(effect.effect == EffectId::NONE) {
        this->turnOff();
        return true;
    }

    int64_t now = esp_timer_get_time();
    this->effect = effect;
    this->effectStart = startUs == 0 ? now : startUs;
    this->lastFrameUs = INT64_MIN / 2;                  // first frame is never throttled
    memset(this->frame, 0xFF, sizeof(this->frame));     // differs from every real frame (24 bit colours)
    this->effectState = EffectState::RUNNING;
    if(now >= this->effectStart) {
        this->renderEffect(now);
    }
    return true;
}

void LEDManager::serviceEffect()
{
    int64_t now = esp_timer_get_time();
    if(now < this->effectStart) {
        return;     // not started yet
    }
    // frame rate limit, except for the end frame (a countdown ends on time)
    bool ended = this->effect.durationMs != 0 && now - this->effectStart >= (int64_t)this->effect.durationMs * 1000;
    if(!ended && now - this->lastFrameUs < MIN_FRAME_US) {
        return;
    }
    this->renderEffect(now);
}

void LEDManager::renderEffect(int64_t nowUs)
{
    const EffectDesc& e = this->effect;
    const bool reverse = (e.flags & Protocol::EFFECT_FLAG_REVERSE) != 0;

    int64_t elapsedUs = nowUs - this->effectStart;
    if(elapsedUs < 0) {
        elapsedUs = 0;
    }
    uint32_t elapsedMs = elapsedUs / 1000 > (int64_t)UINT32_MAX ? UINT32_MAX : (uint32_t)(elapsedUs / 1000);
    uint32_t period = e.periodMs != 0 ? e.periodMs : 1000;

    bool timed = false;         // ends after durationMs in its end frame
    bool still = false;         // never changes (solid, level)
    switch(e.effect) {
        case EffectId::FILL:
        case EffectId::DRAIN:
        case EffectId::DIM:
        case EffectId::COLOR_SHIFT:
        case EffectId::TRAFFIC_LIGHT:
            timed = true;
            break;
        case EffectId::SOLID:
        case EffectId::LEVEL:
            still = true;
            break;
        default:
            break;
    }
    // periodic effects (blink, pulse, spin) end only with a durationMs
    bool finished = timed ? elapsedMs >= e.durationMs : (!still && e.durationMs != 0 && elapsedMs >= e.durationMs);
    // progress of a timed effect, 0 .. 1024
    uint32_t progress = !timed || finished ? 1024 : (uint32_t)((uint64_t)elapsedMs * 1024 / e.durationMs);

    ColorSet c1 = {0, 0, 0};        // unknown colour indices stay dark
    ColorSet c2 = {0, 0, 0};
    LEDManager::colorOf(e.color, c1);
    LEDManager::colorOf(e.color2, c2);
    const uint32_t on = this->scaled(c1, e.brightness);
    const uint32_t off = this->scaled(c2, e.brightness);

    uint32_t next[NEOPIXEL_SIZE];
    if(finished && (e.flags & Protocol::EFFECT_FLAG_END_OFF) != 0) {
        fillAll(next, 0);
    } else {
        switch(e.effect) {
            case EffectId::FILL:
            {
                uint8_t n = finished ? NEOPIXEL_SIZE : (uint8_t)((uint64_t)elapsedMs * NEOPIXEL_SIZE / e.durationMs);
                bar(next, n, on, off, reverse);
                break;
            }
            case EffectId::DRAIN:
            {
                // the last LED goes out exactly at the end
                uint8_t n = finished ? 0 : (uint8_t)(((uint64_t)(e.durationMs - elapsedMs) * NEOPIXEL_SIZE
                                                      + e.durationMs - 1) / e.durationMs);
                bar(next, n, on, off, reverse);
                break;
            }
            case EffectId::DIM:
            {
                int32_t level = (int32_t)e.param + (((int32_t)e.brightness - (int32_t)e.param) * (int32_t)progress) / 1024;
                fillAll(next, this->scaled(c1, (uint8_t)level));
                break;
            }
            case EffectId::COLOR_SHIFT:
            {
                int32_t p = (int32_t)progress;
                ColorSet mix = {
                    (uint8_t)(c1.red + ((int32_t)c2.red - c1.red) * p / 1024),
                    (uint8_t)(c1.green + ((int32_t)c2.green - c1.green) * p / 1024),
                    (uint8_t)(c1.blue + ((int32_t)c2.blue - c1.blue) * p / 1024)
                };
                fillAll(next, this->scaled(mix, e.brightness));
                break;
            }
            case EffectId::TRAFFIC_LIGHT:
            {
                uint32_t third = finished ? 2 : (uint32_t)((uint64_t)elapsedMs * 3 / e.durationMs);
                ColorSet light = {0, 0, 0};
                LEDManager::colorOf(third == 0 ? Protocol::Color::GREEN
                                    : third == 1 ? Protocol::Color::YELLOW : Protocol::Color::RED, light);
                fillAll(next, this->scaled(light, e.brightness));
                break;
            }
            case EffectId::BLINK:
                fillAll(next, finished || elapsedMs % period < period / 2 ? on : off);
                break;

            case EffectId::PULSE:
            {
                if(finished) {
                    fillAll(next, on);
                    break;
                }
                // bright -> dark -> bright, eased (squared triangle)
                uint32_t phase = (uint32_t)((uint64_t)(elapsedMs % period) * 1024 / period);
                uint32_t tri = phase < 512 ? 1024 - 2 * phase : 2 * phase - 1024;
                uint32_t eased = (tri * tri) >> 10;
                fillAll(next, this->scaled(c1, (uint8_t)((e.brightness * eased) >> 10)));
                break;
            }
            case EffectId::SPIN:
            {
                if(finished) {
                    fillAll(next, on);
                    break;
                }
                uint8_t segment = e.param == 0 ? 3 : (e.param > NEOPIXEL_SIZE ? NEOPIXEL_SIZE : e.param);
                uint8_t head = (uint8_t)((uint64_t)(elapsedMs % period) * NEOPIXEL_SIZE / period);
                fillAll(next, off);
                for(uint8_t k = 0; k < segment; k++) {
                    next[ringPos(head + k, reverse)] = on;
                }
                break;
            }
            case EffectId::LEVEL:
            {
                uint32_t percent = e.param > 100 ? 100 : e.param;
                bar(next, (uint8_t)((percent * NEOPIXEL_SIZE + 50) / 100), on, off, reverse);
                break;
            }
            case EffectId::SOLID:
            default:
                fillAll(next, on);
                break;
        }
    }

    if(memcmp(next, this->frame, sizeof(next)) != 0) {
        memcpy(this->frame, next, sizeof(next));
        for(uint8_t i = 0; i < NEOPIXEL_SIZE; i++) {
            this->pixelManager->setPixelColor(i, next[i]);
        }
        this->pixelManager->show();
        this->lastFrameUs = nowUs;
    }

    if(still || finished) {
        this->effectState = EffectState::HOLD;      // nothing changes any more
    }
}
