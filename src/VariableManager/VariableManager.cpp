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

VarId VariableManager::find(const char* varName) const {
    for(size_t i = 0; i < this->names.size(); i++) {
        if(this->names[i] == varName) {
            return (VarId)i;
        }
    }
    return -1;
}

VarId VariableManager::resolve(const char* varName) {
    VarId id = this->find(varName);
    if(id >= 0) {
        return id;
    }
    this->names.push_back(varName);
    this->values.push_back(0);
    return (VarId)(this->names.size() - 1);
}

int64_t VariableManager::get(VarId id) const {
    if(id < 0 || (size_t)id >= this->values.size()) {
        return 0;
    }
    return this->values[id];
}

void VariableManager::set(VarId id, int64_t value) {
    if(id < 0 || (size_t)id >= this->values.size()) {
        return;
    }
    this->values[id] = value;
    ESP_LOGD("VariableManager", "%s = %lld", this->names[id].c_str(), value);
}

const char* VariableManager::name(VarId id) const {
    if(id < 0 || (size_t)id >= this->names.size()) {
        return "?";
    }
    return this->names[id].c_str();
}

int64_t VariableManager::getVariable(const char* varName) const {
    return this->get(this->find(varName));
}

void VariableManager::setVariable(const char* varName, int64_t value) {
    this->set(this->resolve(varName), value);
}

void VariableManager::clear() {
    this->names.clear();
    this->values.clear();
}
