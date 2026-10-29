#pragma once

#include "Roles/IRole.h"

enum class Role {
    CENTRAL,
    PERIPHERAL
};

/**
 * Creates the role chosen at boot and runs it, together with the USB serial console.
 */
class RoleManager {
    public:
        static RoleManager* getManager();

        void boot(Role role);
        void run();

        // The role may wait for the next radio frame (IRole::idle); false before boot()
        bool idle() const;

        // The active role, nullptr before boot()
        IRole* current() const { return this->role; }

    private:
        RoleManager() {}
        static RoleManager* manager;
        IRole* role = nullptr;
};
