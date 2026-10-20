#include <Arduino.h>
#include "Config/Console.h"
#include "RoleManager.h"
#include "_Definitions.h"
#include "Roles/Central/CentralRole.h"
#include "Roles/Peripheral/PeripheralRole.h"
#include "Config/SerialConsole.h"
#include "Diagnostics/Diag.h"
#include "LEDManager/LEDManager.h"

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
            Console.println("Booting in Central mode");
            this->role = new CentralRole();
            break;
        case Role::PERIPHERAL:
            Console.println("Booting in Peripheral mode");
            this->role = new PeripheralRole();
            break;
    }

    JsonDocument event;
    event["event"] = "boot";
    event["role"] = this->role->name();
    event["firmware"] = String(FW_VERSION_MAJOR) + "." + String(FW_VERSION_MINOR);
    Diag::describe(event["lastReset"].to<JsonObject>());
    SerialConsole::emit(event);
    Diag::step("loop");
}

void RoleManager::run() {
    SerialConsole::get().service();
    if(this->role != nullptr) {
        this->role->run();
    }
    // after the role: an effect started in this pass already showed its first frame
    LEDManager::getManager()->service();
}
