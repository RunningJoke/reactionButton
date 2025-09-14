#ifndef BLOCKCONFIGS_H
#define BLOCKCONFIGS_H

#include <Arduino.h>
#include "Block/IBlockConfiguration.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/LEDBlock/LEDBlock.h"
#include "Block/ButtonBlock/ButtonBlock.h"
#include "Block/IfBlock/IfBlock.h"
#include "Block/SetVariableBlock/SetVariableBlock.h"
#include "Block/RemotePressBlock/RemotePressBlockConfiguration.h"
#include "LEDManager/LEDManager.h"
#include "VariableManager/VariableManager.h"
#include "BlockManager/BlockManager.h"

extern void initRandomMode(uint64_t peripheralCount, int64_t maxLoops);
extern void initReactionMode();
extern void initStarMode(uint64_t peripheralCount, int64_t maxLoops);


#endif