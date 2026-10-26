#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "VariableManager/VariableManager.h"

/**
 * A block parameter that is either a constant or a reference to a program variable.
 *
 * JSON:  "value": 12                 -> constant 12
 *        "value": "MAX_LOOPS"        -> current value of variable MAX_LOOPS
 *
 * Variable names are resolved to ids once at load time, so reading a Value at runtime
 * is a plain array access.
 */
class Value {
    public:
        Value() {}
        explicit Value(int64_t constant) : constant(constant), present(true) {}

        // Parses a JSON number or variable name. Leaves the value unchanged (default) if
        // the field is missing. Returns false for any other JSON type.
        bool parse(JsonVariantConst json, VariableManager& vars);

        int64_t get(const VariableManager& vars) const {
            return varId >= 0 ? vars.get(varId) : constant;
        }

        // true if the value is a constant (not a variable); constantValue() is then final
        bool isConstant() const { return varId < 0; }
        int64_t constantValue() const { return constant; }

        // true if the field was given in JSON (or a default was passed to the constructor)
        bool isSet() const { return present; }

    private:
        int64_t constant = 0;
        VarId varId = -1;
        bool present = false;
};
