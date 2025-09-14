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


extern LEDBlockConfiguration* resetLED;
extern DelayBlockConfiguration* resetDelay;
extern LEDBlockConfiguration* clearLED;
extern SetVariableBlockConfiguration* resetVar1;
extern SetVariableBlockConfiguration* startLoop;
extern SetVariableBlockConfiguration* randomBuzzer;
extern IfBlockConfiguration* buzzerSelect;
extern ButtonBlockConfiguration* mainBuzzer;
extern LEDBlockConfiguration* buzzerLED;
extern LEDBlockConfiguration* mainBuzzerPressed;
extern RemotePressBlockConfiguration* remoteBuzzer;
extern IfBlockConfiguration* checkEnd;

extern void initReactionMode();
extern void initBlockRandomTriangle();

#endif