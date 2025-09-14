#ifndef REMOTE_PRESSBLOCK_H
#define REMOTE_PRESSBLOCK_H

#include <Arduino.h>
#include "Block/VBlock.h"
#include "LEDManager/LEDManager.h"
#include "VariableManager/VariableManager.h"
#include "ColorSet/ColorSet.h"
#include "_Definitions.h"


class RemotePressBlockConfiguration;

class RemotePressBlock : public VBlock {

    protected:
    RemotePressBlockConfiguration* blockConfiguration;
    uint64_t timestamp = 0;
    uint64_t timeout = 0;
    uint8_t tmpState = 0;

public:
    RemotePressBlock(RemotePressBlockConfiguration* blockConfiguration);
    ~RemotePressBlock();

    void reset();

    block_err_t executeBlock() override;
    block_err_t enterBlock() override;

    bool activated = false;
};

#include "Block/RemotePressBlock/RemotePressBlockConfiguration.h"

#endif