#ifndef REMOTE_MULTIPLE_PRESSBLOCK_H
#define REMOTE_MULTIPLE_PRESSBLOCK_H

#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "VariableManager/VariableManager.h"
#include "ColorSet/ColorSet.h"
#include "_Definitions.h"


class RemoteMultiplePressBlockConfiguration;

class RemoteMultiplePressBlock : public VBlock {

    protected:
    RemoteMultiplePressBlockConfiguration* blockConfiguration;
    uint64_t timestamp = 0;
    uint64_t timeout = 0;
    uint8_t tmpState = 0;
    
    public:
    RemoteMultiplePressBlock(RemoteMultiplePressBlockConfiguration* blockConfiguration);
    ~RemoteMultiplePressBlock();
    
    void reset();
    
    block_err_t executeBlock() override;
    block_err_t enterBlock() override;
    
    bool localPressed = false;
    uint8_t remainingCount; // Number of remaining peripherals to be triggered
    bool avoidWasHit = false;
    bool centralIsAvoid = false;
};

#include "Block/RemoteMultiplePressBlock/RemoteMultiplePressBlockConfiguration.h"

#endif