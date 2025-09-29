#ifndef REMOTE_RESET_BLOCK_H
#define REMOTE_RESET_BLOCK_H

#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "VariableManager/VariableManager.h"
#include "ColorSet/ColorSet.h"
#include "_Definitions.h"


class RemoteResetAllBlocksConfiguration;

class RemoteResetAllBlocks : public VBlock {

    protected:
    RemoteResetAllBlocksConfiguration* blockConfiguration;
    
    public:
    RemoteResetAllBlocks(RemoteResetAllBlocksConfiguration* blockConfiguration);
    ~RemoteResetAllBlocks();
        
    block_err_t executeBlock() override;
    
};

#include "Block/RemoteResetAllBlocks/RemoteResetAllBlocksConfiguration.h"

#endif