#include "BlockConfigs.h"



/**
 * RESET BLOCK CHAIN
 */

LEDBlockConfiguration* resetLED = new LEDBlockConfiguration(
    "StartReset",
    "ResetDelay",
    BLUE
);

DelayBlockConfiguration* resetDelay = new DelayBlockConfiguration(
    "ResetDelay",
    "ClearLED",
    3000,
    3000
); 

LEDBlockConfiguration* clearLED = new LEDBlockConfiguration(
    "ClearLED",
    "ResetVar1",
    BLACK
);

SetVariableBlockConfiguration* resetVar1 = new SetVariableBlockConfiguration(
    "ResetVar1",
    "StartLoop",
    "RUNS",
    '=',
    0
);

/**
 * END OF RESET BLOCK CHAIN
 */


/**
 * START OF MAIN BLOCK CHAIN
 */

SetVariableBlockConfiguration* startLoop = new SetVariableBlockConfiguration(
    "StartLoop",
    "RandomBuzzer",
    "RUNS",
    '+',
    1
);

SetVariableBlockConfiguration* randomBuzzer = new SetVariableBlockConfiguration(
    "RandomBuzzer",
    "BuzzerSelect",
    "SELECTED_BUZZER",
    '!',
    3
);

IfBlockConfiguration* buzzerSelect = new IfBlockConfiguration(
    "BuzzerSelect",
    '=',
    "SELECTED_BUZZER",
    "REQUIRED_PERIPHERALS",
    "MainBuzzerLed",
    "RemoteBuzzer"
);

LEDBlockConfiguration* buzzerLED = new LEDBlockConfiguration(
    "MainBuzzerLed",
    "MainBuzzer",
    GREEN
);

ButtonBlockConfiguration* mainBuzzer = new ButtonBlockConfiguration(
    "MainBuzzer",
    "MainBuzzerPressed"
);

LEDBlockConfiguration* mainBuzzerPressed = new LEDBlockConfiguration(
    "MainBuzzerPressed",
    "CheckEnd",
    BLACK
);

RemotePressBlockConfiguration* remoteBuzzer = new RemotePressBlockConfiguration(
    "RemoteBuzzer",
    "CheckEnd",
    "SELECTED_BUZZER"
);

IfBlockConfiguration* checkEnd = new IfBlockConfiguration(
    "CheckEnd",
    '=',
    "RUNS",
    "MAX_LOOPS",
    "StartReset",
    "StartLoop"
);


void initBlockRandomTriangle() {
    VariableManager* variableManager = VariableManager::getManager();

    variableManager->setVariable("REQUIRED_PERIPHERALS", 2);

    variableManager->setVariable("RUNS", 0);
    variableManager->setVariable("MAX_LOOPS", 5);
    variableManager->setVariable("SELECTED_BUZZER", 0);

    BlockManager* bm = BlockManager::getManager();

    bm->assignBlock(resetLED);
    bm->assignBlock(resetDelay);
    bm->assignBlock(clearLED);
    bm->assignBlock(resetVar1);
    bm->assignBlock(startLoop);
    bm->assignBlock(randomBuzzer);
    bm->assignBlock(buzzerSelect);
    bm->assignBlock(buzzerLED);
    bm->assignBlock(mainBuzzer);
    bm->assignBlock(mainBuzzerPressed);
    bm->assignBlock(remoteBuzzer);
    bm->assignBlock(checkEnd);

    bm->defineStartBlock("StartLoop");
}