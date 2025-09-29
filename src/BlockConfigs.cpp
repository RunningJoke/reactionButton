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

SetVariableBlockConfiguration* resetRunCounter = new SetVariableBlockConfiguration(
    "ResetVar1",
    "StartLoop",
    "RUNS",
    '=',
    0
);

SetVariableBlockConfiguration* startLoop = new SetVariableBlockConfiguration(
    "StartLoop",
    "EnterProgram",
    "RUNS",
    '+',
    1
);


IfBlockConfiguration* endLoop = new IfBlockConfiguration(
    "EndLoop",
    '=',
    "RUNS",
    "MAX_LOOPS",
    "StartReset",
    "StartLoop"
);

/**
 * END OF RESET BLOCK CHAIN
 */


/**
 * START OF REACTION MODE
 */

ButtonBlockParameter rm_waitConfig = ButtonBlockParameter{
    .shortPressLimit = 0,
    .longPressMinimum = 0,
    .minTimeout = 800,
    .maxTimeout = 5000,
    .randomizeTimeout = true
    };

ButtonBlockConfiguration* rm_ButtonWaitBlock = new ButtonBlockConfiguration(
    "Button Wait Block",
    "LEDRed",
    nullptr, nullptr, nullptr, "LEDGreen", &rm_waitConfig
);

LEDBlockConfiguration* rm_LEDRed = new LEDBlockConfiguration(
    "LEDRed",
    "ResetDelay",
    RED
);

LEDBlockConfiguration* rm_LEDGreen = new LEDBlockConfiguration(
    "LEDGreen",
    "Button Block",
    GREEN
);

LEDBlockConfiguration* rm_LEDBlue = new LEDBlockConfiguration(
    "LEDBlue",
    "Button Wait Block",
    BLUE
);

ButtonBlockConfiguration* rm_ButtonBlock = new ButtonBlockConfiguration(
    "Button Block",
    "LEDCyan"
);

LEDBlockConfiguration* rm_LEDCyan = new LEDBlockConfiguration(
    "LEDCyan",
    "ResetDelay",
    CYAN
);

DelayBlockConfiguration* rm_TimeToReset = new DelayBlockConfiguration(
    "ResetDelay",
    "LEDBlue",
    2500,
    2500
);

/**
  * END OF REACTION MODE
  */




/**
 * START OF RANDOM BLOCK CHAIN
 */

DelayBlockConfiguration* rtm_startProgramTriangle = new DelayBlockConfiguration(
    "EnterProgram",
    "RandomBuzzer",
    10,
    10
);


SetVariableBlockConfiguration* rtm_randomBuzzer = new SetVariableBlockConfiguration(
    "RandomBuzzer",
    "BuzzerSelect",
    "SELECTED_BUZZER",
    '!',
    0
);

IfBlockConfiguration* rtm_buzzerSelect = new IfBlockConfiguration(
    "BuzzerSelect",
    '=',
    "SELECTED_BUZZER",
    "REQUIRED_PERIPHERALS",
    "MainBuzzerLed",
    "RemoteBuzzer"
);

LEDBlockConfiguration* rtm_buzzerLED = new LEDBlockConfiguration(
    "MainBuzzerLed",
    "MainBuzzer",
    GREEN
);

ButtonBlockConfiguration* rtm_mainBuzzer = new ButtonBlockConfiguration(
    "MainBuzzer",
    "MainBuzzerPressed"
);

LEDBlockConfiguration* rtm_mainBuzzerPressed = new LEDBlockConfiguration(
    "MainBuzzerPressed",
    "EndLoop",
    BLACK
);

RemotePressBlockConfiguration* rtm_remoteBuzzer = new RemotePressBlockConfiguration(
    "RemoteBuzzer",
    "EndLoop",
    "SELECTED_BUZZER"
);

/**
 * END OF RANDOM TRIANGLE BLOCK CHAIN
 * 
 */

/**
 * START OF STAR BLOCK CHAIN
 */


DelayBlockConfiguration* sm_Start = new DelayBlockConfiguration(
    "EnterProgram",
    "starLEDOn",
    10,
    10
);


LEDBlockConfiguration* sm_starLEDOn = new LEDBlockConfiguration(
    "starLEDOn",
    "starBuzzer",
    GREEN
);

ButtonBlockConfiguration* sm_starBuzzer = new ButtonBlockConfiguration(
    "starBuzzer",
    "starBuzzerPressed"
);

LEDBlockConfiguration* sm_starBuzzerPressed = new LEDBlockConfiguration(
    "starBuzzerPressed",
    "selectPeripheral",
    BLACK
);

SetVariableBlockConfiguration* sm_selectPeripheral = new SetVariableBlockConfiguration(
    "selectPeripheral",
    "BuzzerSelect",
    "SELECTED_BUZZER",
    '?',
    0
);

RemotePressBlockConfiguration* sm_remoteBuzzer = new RemotePressBlockConfiguration(
    "BuzzerSelect",
    "EndLoop",
    "SELECTED_BUZZER"
);



/**
 * END OF STAR BLOCK CHAIN
 */



 DelayBlockConfiguration* mm_Start = new DelayBlockConfiguration(
    "EnterProgram",
    "activateAll",
    3000,
    3000
);

RemoteMultiplePressBlockConfiguration* mm_remoteMultiple = new RemoteMultiplePressBlockConfiguration(
    "activateAll",
    "ResetAll",
    "REQUIRED_PERIPHERALS",
    "AVOID_COUNT",
    "ResetAll"
);

RemoteResetAllBlocksConfiguration* mm_remoteReset = new RemoteResetAllBlocksConfiguration(
    "ResetAll",
    "EnterProgram",
    "REQUIRED_PERIPHERALS"
);


void registerResetLoop(int64_t maxLoops) {
     VariableManager* variableManager = VariableManager::getManager();
    BlockManager* bm = BlockManager::getManager();
    VariableManager* vm = VariableManager::getManager();

    vm->setVariable("RUNS", 0);
    vm->setVariable("MAX_LOOPS", maxLoops);

    bm->assignBlock(resetLED);
    bm->assignBlock(resetDelay);
    bm->assignBlock(clearLED);
    bm->assignBlock(resetRunCounter);
    bm->assignBlock(startLoop);
    bm->assignBlock(endLoop);

    bm->defineStartBlock("StartLoop");
}

void initReactionMode() {
    VariableManager* variableManager = VariableManager::getManager();

    variableManager->setVariable("REQUIRED_PERIPHERALS", 0);    

    BlockManager* bm = BlockManager::getManager();

    bm->assignBlock(rm_LEDBlue);
    bm->assignBlock(rm_ButtonWaitBlock);
    bm->assignBlock(rm_LEDRed);
    bm->assignBlock(rm_LEDGreen);
    bm->assignBlock(rm_ButtonBlock);
    bm->assignBlock(rm_LEDCyan);
    bm->assignBlock(rm_TimeToReset);
    bm->defineStartBlock("LEDBlue");


}

void initRandomMode(uint64_t nodeCount, int64_t maxLoops) {
    VariableManager* variableManager = VariableManager::getManager();

    variableManager->setVariable("REQUIRED_PERIPHERALS", nodeCount - 1);    
    variableManager->setVariable("SELECTED_BUZZER", 0);

    BlockManager* bm = BlockManager::getManager();

    rtm_randomBuzzer->changeSize = nodeCount;

    registerResetLoop(maxLoops);

    bm->assignBlock(rtm_startProgramTriangle);
    bm->assignBlock(rtm_randomBuzzer);
    bm->assignBlock(rtm_buzzerSelect);
    bm->assignBlock(rtm_buzzerLED);
    bm->assignBlock(rtm_mainBuzzer);
    bm->assignBlock(rtm_mainBuzzerPressed);
    bm->assignBlock(rtm_remoteBuzzer);
}


void initStarMode(uint64_t nodeCount, int64_t maxLoops) {
    VariableManager* variableManager = VariableManager::getManager();

    registerResetLoop(maxLoops);

    variableManager->setVariable("REQUIRED_PERIPHERALS", nodeCount - 1);    
    variableManager->setVariable("SELECTED_BUZZER", 0);

    BlockManager* bm = BlockManager::getManager();

    sm_selectPeripheral->changeSize = nodeCount - 1;

    bm->assignBlock(sm_Start);
    bm->assignBlock(sm_starLEDOn);
    bm->assignBlock(sm_starBuzzer);
    bm->assignBlock(sm_starBuzzerPressed);
    bm->assignBlock(sm_selectPeripheral);
    bm->assignBlock(sm_remoteBuzzer);

}



void initMultipleMode(uint64_t nodeCount, int64_t avoidCount) {
    VariableManager* variableManager = VariableManager::getManager();

    variableManager->setVariable("REQUIRED_PERIPHERALS", nodeCount - 1);    
    variableManager->setVariable("AVOID_COUNT", avoidCount);

    BlockManager* bm = BlockManager::getManager();

    bm->assignBlock(mm_Start);
    bm->assignBlock(mm_remoteMultiple);
    bm->assignBlock(mm_remoteReset);

    
    bm->defineStartBlock("EnterProgram");
}

