#include "SetVariableBlock.h"

SetVariableBlock::SetVariableBlock(SetVariableBlockConfiguration* blockConfiguration) {
    this->blockConfiguration = static_cast<SetVariableBlockConfiguration*>(blockConfiguration);
    this->genericBlockConfiguration = blockConfiguration;
}

SetVariableBlock::~SetVariableBlock() {
    // Destructor implementation
}   


block_err_t SetVariableBlock::executeBlock() {
        
    switch(this->blockConfiguration->operatorType) {
        case '?':
        {
            auto randomResult = (int64_t)random(0 , this->blockConfiguration->changeSize);
            VariableManager::getManager()->setVariable(this->blockConfiguration->variableName, randomResult);
            break;
        }
        case '!':
        {
            auto currentValue = VariableManager::getManager()->getVariable(this->blockConfiguration->variableName);            
            auto randomResult = (int64_t)random(0 , this->blockConfiguration->changeSize);
            while(randomResult == currentValue) {
                randomResult = (int64_t)random(0 , this->blockConfiguration->changeSize);
            }
            VariableManager::getManager()->setVariable(this->blockConfiguration->variableName, randomResult);
            Serial.println(randomResult);
            break;
        }
        case '=':
            VariableManager::getManager()->setVariable(this->blockConfiguration->variableName, this->blockConfiguration->changeSize);
            break;
        case '+':
            {
                int64_t currentValue = VariableManager::getManager()->getVariable(this->blockConfiguration->variableName);
                int64_t newValue = currentValue + this->blockConfiguration->changeSize;
                VariableManager::getManager()->setVariable(this->blockConfiguration->variableName, newValue);
            }
            break;
        case '-':
            {
                int64_t currentValue = VariableManager::getManager()->getVariable(this->blockConfiguration->variableName);
                int64_t newValue = currentValue - this->blockConfiguration->changeSize;
                VariableManager::getManager()->setVariable(this->blockConfiguration->variableName, newValue);
            }
            break;
        default:
            return -1; // Error: Unknown operator
    }
    return 0;
}

