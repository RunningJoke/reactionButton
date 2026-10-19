#include "Value.h"

bool Value::parse(JsonVariantConst json, VariableManager& vars) {
    if(json.isNull()) {
        return true;
    }
    if(json.is<int64_t>()) {
        this->constant = json.as<int64_t>();
        this->varId = -1;
        this->present = true;
        return true;
    }
    if(json.is<const char*>()) {
        this->varId = vars.resolve(json.as<const char*>());
        this->present = true;
        return true;
    }
    return false;
}
