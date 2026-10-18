#pragma once

/**
 * A pod runs exactly one role (central or peripheral), chosen at boot.
 */
class IRole {
    public:
        virtual ~IRole() {}

        // Called once per loop pass
        virtual void run() = 0;
};
