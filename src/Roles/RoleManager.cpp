#include <Arduino.h>
#include "RoleManager.h"
#include "Roles/Central/CentralRole.h"
#include "Roles/Peripheral/PeripheralRole.h"

RoleManager* RoleManager::manager = nullptr;

RoleManager* RoleManager::getManager() {
    if(RoleManager::manager == nullptr) {
        RoleManager::manager = new RoleManager();
    }
    return RoleManager::manager;
}

void RoleManager::boot(Role role) {
    switch(role) {
        case Role::CENTRAL:
            Serial.println("Booting in Central mode");
            this->role = new CentralRole();
            break;
        case Role::PERIPHERAL:
            Serial.println("Booting in Peripheral mode");
            this->role = new PeripheralRole();
            break;
    }
}

void RoleManager::run() {
    if(this->role != nullptr) {
        this->role->run();
    }
}
