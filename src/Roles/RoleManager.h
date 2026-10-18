#pragma once

#include "Roles/IRole.h"

enum class Role {
    CENTRAL,
    PERIPHERAL
};

/**
 * Creates the role chosen at boot and runs it.
 */
class RoleManager {
    public:
        static RoleManager* getManager();

        void boot(Role role);
        void run();

    private:
        RoleManager() {}
        static RoleManager* manager;
        IRole* role = nullptr;
};
