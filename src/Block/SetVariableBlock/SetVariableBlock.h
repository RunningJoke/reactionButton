#ifndef SETVARIABLEBLOCK_H
#define SETVARIABLEBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "VariableManager/VariableManager.h"


struct SetVariableBlockConfiguration : public IBlockConfiguration {
    const char* variableName;
    char operatorType;
    int64_t changeSize;

    SetVariableBlockConfiguration(const char* blockName, const char* nextBlockName, const char* variableName, char operatorType, int64_t changeSize)
        : IBlockConfiguration(blockName, BlockType::SET_VARIABLE, nextBlockName) {
            this->variableName = variableName;
            this->operatorType = operatorType;
            this->changeSize = changeSize;
        }
};

class SetVariableBlock : public VBlock {

    protected:
        SetVariableBlockConfiguration* blockConfiguration;
        uint64_t timestamp = 0;

    public:
        SetVariableBlock(SetVariableBlockConfiguration* blockConfiguration);
        ~SetVariableBlock();

        block_err_t executeBlock() override;

};

#endif