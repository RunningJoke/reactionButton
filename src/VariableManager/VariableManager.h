#pragma once

#include <Arduino.h>
#include <map>
#include <string>


class VariableManager {
    protected:

        static VariableManager* manager;
        VariableManager();

        std::map<std::string, int64_t> variableMap;
    public:
        static VariableManager* getManager();

        int64_t getVariable(const char* varName);
        void setVariable(const char* varName, int64_t value);
        
};