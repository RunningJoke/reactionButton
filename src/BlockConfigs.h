#ifndef BLOCKCONFIGS_H
#define BLOCKCONFIGS_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/LEDBlock/LEDBlock.h"
#include "Block/ButtonBlock/ButtonBlock.h"

DelayBlockConfiguration* DelayBlock1000ms = new DelayBlockConfiguration(
    "Delay 1000ms",
    "LEDRed",
    1000
);

LEDBlockConfiguration* LEDRed = new LEDBlockConfiguration(
    "LEDRed",
    "Button Block",
    RED
);

ButtonBlockConfiguration* ButtonBlock = new ButtonBlockConfiguration(
    "Button Block",
    "LEDGreen"
);

LEDBlockConfiguration* LEDGreen = new LEDBlockConfiguration(
    "LEDGreen",
    "Delay 1000ms",
    GREEN
);



#endif