#ifndef BOOTUP_ANIMATION_H
#define BOOTUP_ANIMATION_H
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"

extern int bootupIds[18];
extern LEDPaletteID* bootupPalette;
extern LEDPattern bootupPattern;

class BootupAnimation : public LEDAnimation {
    public:
        BootupAnimation(LEDPaletteID* ids) {
            this->ids = ids;
        }
        LEDPaletteID* ids;
        uint64_t lastTimestamp = 0;
        int updateIndex = 0;

        void animate(uint64_t timestamp) override {
            if(lastTimestamp + 50UL < timestamp) {
                lastTimestamp = timestamp;
                this->ids->setPaletteID(updateIndex, 0);
                updateIndex++;                
                if(updateIndex < NEOPIXEL_SIZE) {
                  this->ids->setPaletteID(updateIndex, 1);
                } else {
                  updateIndex = 0;
                  this->ids->setPaletteID(updateIndex, 1);
                }
            }
        }
  };

#endif