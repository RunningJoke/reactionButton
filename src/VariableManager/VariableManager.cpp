#include "VariableManager.h"


VariableManager* VariableManager::manager = nullptr;

VariableManager* VariableManager::getManager() {
    if(VariableManager::manager == nullptr) {
        ESP_LOGI("VariableManager", "Initializing Variable manager");
        VariableManager::manager = new VariableManager();
    }
    return VariableManager::manager;
}

VariableManager::VariableManager()
{
    
}


int64_t VariableManager::getVariable(const char* varName) {
    auto it = variableMap.find(varName);
    if (it != variableMap.end()) {
        return it->second;
    }
    return 0; // or some default/error value
}

void VariableManager::setVariable(const char* varName, int64_t value) {
    variableMap[varName] = value;
    Serial.print("Set variable ");
    Serial.print(varName);
    Serial.print(" to ");
    Serial.println(value);
    
}