#pragma once

#include <Arduino.h>
#include <string>
#include <vector>

typedef int16_t VarId;

/**
 * Program variables (int64). Names are resolved to a VarId once when a program is
 * loaded; at runtime blocks access variables by id, without string lookups.
 * Unknown variables read as 0.
 */
class VariableManager {
    protected:
        static VariableManager* manager;
        VariableManager();

        std::vector<std::string> names;
        std::vector<int64_t> values;

    public:
        static VariableManager* getManager();

        // Returns the id of a variable, creating it (value 0) if it does not exist yet
        VarId resolve(const char* varName);

        // Returns -1 if the variable does not exist
        VarId find(const char* varName) const;

        int64_t get(VarId id) const;
        void set(VarId id, int64_t value);
        const char* name(VarId id) const;

        // Convenience access by name
        int64_t getVariable(const char* varName) const;
        void setVariable(const char* varName, int64_t value);

        size_t count() const { return this->values.size(); }

        // Removes all variables (when a new program is loaded)
        void clear();
};
