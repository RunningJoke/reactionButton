#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "ColorSet/ColorSet.h"
#include "Link/Protocol.h"

#define LED_PIN 7
#define NEOPIXEL_SIZE 18

struct LEDPaletteID {
    uint64_t bitmask;

    LEDPaletteID(int palette[18]) {
        this->bitmask = 0;
        for(int i = 0; i < NEOPIXEL_SIZE; i++) {
            this->setPaletteID(i,palette[i]);
        }
    }

    void setPaletteID(int led, uint8_t paletteId) {
        this->bitmask &= ~(0x7ULL << (3*led));           // Clear the 3 bits
        this->bitmask |= (uint64_t(paletteId & 0x7) << (3*led)); // Set new value
    };
    uint8_t getPaletteID(int i) {
        return (this->bitmask >> (3*i)) & 0x7;
    }
};

class LEDAnimation {
    public:
        virtual void animate(uint64_t timestamp) = 0;
};

struct LEDPattern {
    ColorSet* palette[8];
    LEDPaletteID* ids;
    LEDAnimation* animation;
};

/**
 * The LED ring.
 *
 * Static output: setLEDColors(...) / turnOff(). Every static call stops a running effect.
 *
 * Effect player: one effect at a time (Protocol::EffectDesc, link-protocol.md §2.1).
 * An effect is a pure function of the time since its start, so pods that were given the
 * same start time on the synchronised clock show the same frame, and a late start only
 * skips ahead. service() (once per loop pass, RoleManager::run) draws a new frame only when
 * it differs from the last one, at most every MIN_FRAME_US. When no effect animates,
 * service() returns at once and isAnimating() is false (light sleep allowed, #21).
 *
 * All output is scaled by the brightness cap (default 255 = unchanged).
 */
class LEDManager {
    protected:
        ColorSet* pOffConfiguration;
        ColorSet* pCurrentColorConfiguration;

        uint8_t neoPixelPin;
        Adafruit_NeoPixel* pixelManager;

        static LEDManager* manager;
        LEDManager(uint8_t neoPixelPin);
    public:
        static LEDManager* getManager();
        void setLEDColors(ColorSet* pNewColorSet);
        void setLEDColors(uint8_t colorId);
        void setLEDColors(uint8_t index, ColorSet* pNewColorSet);
        void setLEDColors(LEDPattern* pattern);
        void turnOff();

        // ------------------------------------------------------------ effect player

        // Plays an effect. startUs = local esp_timer time (µs); 0 = now. On the central the
        // network time (IPodNetwork::nowUs) is the local time; a peripheral converts with
        // ClockSync::toLocal. If the start time has come, the first frame is shown before
        // this returns (reaction times are measured from it). Before a later start time the
        // LEDs stay as they are. EffectId::NONE stops and switches off.
        // Returns false (nothing changed) for an unknown effect id.
        bool playEffect(const Protocol::EffectDesc& effect, int64_t startUs = 0);

        // Stops the effect; the LEDs keep the last frame
        void stopEffect() { this->effectState = EffectState::IDLE; }

        // Advances the effect. Call once per loop pass.
        void service() {
            if(this->effectState == EffectState::RUNNING) {
                this->serviceEffect();
            }
        }

        // An effect still changes the LEDs (or waits for its start). False = light sleep allowed.
        bool isAnimating() const { return this->effectState == EffectState::RUNNING; }

        // Id of the last effect played (NONE after a static call or stop). A finished or static
        // effect keeps its id, isAnimating() tells whether it still moves.
        Protocol::EffectId currentEffect() const {
            return this->effectState == EffectState::IDLE ? Protocol::EffectId::NONE : this->effect.effect;
        }

        // Local start time of the current effect (µs)
        int64_t effectStartUs() const { return this->effectStart; }

        // Upper limit for all output (battery / power, #21). Applies from the next frame / call.
        void setBrightnessCap(uint8_t cap) { this->cap = cap; }
        uint8_t brightnessCap() const { return this->cap; }

        // RGB of a link colour index (0 red … 6 white, 255 off). False for unknown indices.
        static bool colorOf(uint8_t colorId, ColorSet& out);

        // Effect names as used in JSON ("fill", "colorShift", …); nullptr / NONE if unknown
        static const char* effectName(Protocol::EffectId id);
        static Protocol::EffectId effectFromName(const char* name);

        static const int64_t MIN_FRAME_US = 16000;     // at most ~60 frames per second

    private:
        enum class EffectState : uint8_t { IDLE, RUNNING, HOLD };    // HOLD: finished or static, last frame stays

        uint32_t scaled(const ColorSet& color, uint8_t level) const;
        void serviceEffect();
        void renderEffect(int64_t nowUs);

        Protocol::EffectDesc effect = {Protocol::EffectId::NONE, 0, 0, 0, 0, 0, 0, 0};
        EffectState effectState = EffectState::IDLE;
        int64_t effectStart = 0;
        int64_t lastFrameUs = 0;
        uint32_t frame[NEOPIXEL_SIZE];
        uint8_t cap = 255;
};
