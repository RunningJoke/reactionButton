#pragma once

#include <Arduino.h>
#include "Roles/IRole.h"
#include "Roles/Central/PodNetwork.h"
#include "Roles/Central/PhoneConfig.h"
#include "Program/ProgramCatalog.h"
#include "ColorSet/ColorSet.h"

/**
 * CENTRAL role.
 *
 *   MENU       program menu, phone config via BLE (settings, program upload/download).
 *              Long press selects a program. Without programs: red blinking, upload possible.
 *   DISCOVERY  BLE off, ESP-NOW on. Claims peripherals until the program has enough
 *              (blue progress bar).
 *   CONFIRM    all green. A press starts the program.
 *              In DISCOVERY, CONFIRM and PAUSED the program stores of all pods are synced.
 *   RUN        block engine runs.
 *   PAUSED     a peripheral stopped answering: all yellow. When it is back, the current
 *              block is restarted (re-arms the pods) and the game continues.
 *   ERROR      red blinking: no programs, program error or radio failure.
 */
class CentralRole : public IRole {
    public:
        CentralRole();
        void run() override;

    private:
        enum class State : uint8_t { MENU, DISCOVERY, CONFIRM, RUN, PAUSED, ERROR };

        static const uint8_t MAX_PERIPHERALS = 7;

        bool runModelSelector();
        void reloadMenu();
        bool startProgram();
        void drawProgress();
        void fail(const char* message);

        State state = State::MENU;
        ProgramCatalog catalog;
        PhoneConfig phone;
        PodNetwork network;

        // program menu
        uint64_t modelSelectorPressStart = 0;
        uint8_t modelSelectorCounter = 0;
        ColorSet modelSelectorColor = {0, 0, 0};
        uint8_t selectedModel = 0;
        bool waitForBootRelease = false;   // button still held from selecting CENTRAL at boot

        uint8_t requiredPeripherals = 0;
        int16_t drawnPodCount = -1;
        uint32_t pressCountAtConfirm = 0;
};
