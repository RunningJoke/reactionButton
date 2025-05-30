#ifndef BLOCKCONFIGS_H
#define BLOCKCONFIGS_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/LEDBlock/LEDBlock.h"
#include "Block/ButtonBlock/ButtonBlock.h"

int bootUpPatternIdList[] = {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0};

class LEDBootUpAnimation : public LEDAnimation 
{
    public:
    uint64_t lastTimestamp = 0;
    LEDPaletteID* bitmask;
    void animate(uint64_t timestamp) {
        if(this->lastTimestamp + 200UL < timestamp) {
            auto item_1 = bitmask->getPaletteID(0);
            bitmask->bitmask = bitmask->bitmask >> 3;
            bitmask->setPaletteID(17, item_1);
            this->lastTimestamp = timestamp;
        }
    }
};

LEDBootUpAnimation* bootUpAnimation = new LEDBootUpAnimation();


LEDPattern* bootUpPattern = new LEDPattern{
    .palette = {
        BLACK,
        WHITE,
        RED,
        GREEN,
        BLUE,
        YELLOW,
        MAGENTA,
        CYAN
    },
    .ids = new LEDPaletteID(bootUpPatternIdList),
    .animation = bootUpAnimation
};





LEDBlockConfiguration* LEDBlue = new LEDBlockConfiguration(
    "LEDBlue",
    "Button Wait Block",
    BLUE
);

ButtonBlockParameter waitConfig = ButtonBlockParameter{
    .shortPressLimit = 0,
    .longPressMinimum = 0,
    .minTimeout = 800,
    .maxTimeout = 5000,
    .randomizeTimeout = true
};

ButtonBlockConfiguration* ButtonWaitBlock = new ButtonBlockConfiguration(
    "Button Wait Block",
    "LEDRed",
    nullptr, nullptr, nullptr, "LEDGreen", &waitConfig
);


LEDBlockConfiguration* LEDRed = new LEDBlockConfiguration(
    "LEDRed",
    "ResetDelay",
    RED
);

LEDBlockConfiguration* LEDGreen = new LEDBlockConfiguration(
    "LEDGreen",
    "Button Block",
    GREEN
);

ButtonBlockConfiguration* ButtonBlock = new ButtonBlockConfiguration(
    "Button Block",
    "LEDCyan"
);



LEDBlockConfiguration* LEDCyan = new LEDBlockConfiguration(
    "LEDCyan",
    "ResetDelay",
    CYAN
);


DelayBlockConfiguration* TimeToReset = new DelayBlockConfiguration(
    "ResetDelay",
    "LEDBlue",
    2500,
    2500
);





#endif