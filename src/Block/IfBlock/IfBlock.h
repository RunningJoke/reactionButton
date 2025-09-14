#ifndef IFBLOCK_H
#define IFBLOCK_H
#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "VariableManager/VariableManager.h"


struct IfBlockConfiguration : public IBlockConfiguration {
    const char* leftSideVariable;
    const char* rightSideVariable;
    const char* nextBlockNameTrue;
    const char* nextBlockNameFalse;

    bool conditionResult = false;
    char conditionType; // 'E' for equal, 'N' for not equal,

    IfBlockConfiguration(const char* blockName, char type , const char* leftSideVariable , const char* rightSideVariable, const char* nextBlockNameTrue, const char* nextBlockNameFalse)
        : IBlockConfiguration(blockName, BlockType::IF, nullptr) {
            this->leftSideVariable = leftSideVariable;
            this->rightSideVariable = rightSideVariable;
            this->nextBlockNameTrue = nextBlockNameTrue;
            this->nextBlockNameFalse = nextBlockNameFalse;
            this->conditionType = type;
        }

    virtual const char* getNextBlockName() {
        return this->conditionResult ? this->nextBlockNameTrue : this->nextBlockNameFalse;
    }
};

class IfBlock : public VBlock {

    protected:
        IfBlockConfiguration* blockConfiguration;

    public:
        IfBlock(IfBlockConfiguration* blockConfiguration);
        ~IfBlock();

        block_err_t executeBlock() override;

};

#endif