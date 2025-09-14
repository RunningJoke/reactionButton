#include "IfBlock.h"

IfBlock::IfBlock(IfBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<IfBlockConfiguration*>(blockConfiguration);
    this->genericBlockConfiguration = blockConfiguration;
}

IfBlock::~IfBlock() {
    // Destructor implementation
}   

block_err_t IfBlock::executeBlock() {
        
    uint64_t leftValue = VariableManager::getManager()->getVariable(this->blockConfiguration->leftSideVariable);
    uint64_t rightValue = VariableManager::getManager()->getVariable(this->blockConfiguration->rightSideVariable);

    switch(this->blockConfiguration->conditionType) {
        case '=': // Equal
            this->blockConfiguration->conditionResult = (leftValue == rightValue);
            break;
        case '!': // Not equal
            this->blockConfiguration->conditionResult = (leftValue != rightValue);
            break;
        case '>': // Greater than
            this->blockConfiguration->conditionResult = (leftValue > rightValue);
            break;
        case '<': // Less than
            this->blockConfiguration->conditionResult = (leftValue < rightValue);
            break;
    }


    return 0;
}

