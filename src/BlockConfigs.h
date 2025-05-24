#ifndef BLOCKCONFIGS_H
#define BLOCKCONFIGS_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/LEDBlock/LEDBlock.h"

DelayBlockConfiguration* DelayBlock1000ms = new DelayBlockConfiguration{
    .blockName = "Delay 1000ms",
    .blockType = BlockType::DELAY,
    .nextBlockName = "LEDRed",
    .delay = 1000
};

LEDBlockConfiguration* LEDRed = new LEDBlockConfiguration{
    .blockName = "LEDRed",
    .blockType = BlockType::LED,
    .nextBlockName = "Delay 1000ms (2)",
    .color = *RED
};


DelayBlockConfiguration* DelayBlock1000ms_2 = new DelayBlockConfiguration{
    .blockName = "Delay 1000ms (2)",
    .blockType = BlockType::DELAY,
    .nextBlockName = "LEDGreen",
    .delay = 1000
};

LEDBlockConfiguration* LEDGreen = new LEDBlockConfiguration{
    .blockName = "LEDGreen",
    .blockType = BlockType::LED,
    .nextBlockName = "Delay1000ms",
    .color = *GREEN
};

#endif