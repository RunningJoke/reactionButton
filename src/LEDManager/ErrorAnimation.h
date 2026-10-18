#ifndef ERROR_ANIMATION_H
#define ERROR_ANIMATION_H
#include "LEDManager/LEDManager.h"



class ErrorAnimation : public LEDAnimation {
    public:
        ErrorAnimation(LEDPaletteID* ids) {
            this->ids = ids;
        }
        LEDPaletteID* ids;
        uint64_t lastTimestamp = 0;
        bool toggleFlash = false;

        void animate(uint64_t timestamp) override {
            if(lastTimestamp + 1000UL < timestamp) {
                lastTimestamp = timestamp;
                if(toggleFlash) {
                  for(int i = 0; i < NEOPIXEL_SIZE; i++) {
                    this->ids->setPaletteID(i, 1);
                  }
                  toggleFlash = false;
                } else {
                  for(int i = 0; i < NEOPIXEL_SIZE; i++) {
                    this->ids->setPaletteID(i, 0);
                  }
                  toggleFlash = true;
                }                
            }
        }
};

  //bootup animation
extern int errorIds[18];
extern LEDPaletteID* errorPalette;
extern LEDPattern* errorPattern;

#endif