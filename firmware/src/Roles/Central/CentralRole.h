#pragma once

#include <Arduino.h>
#include "Roles/IRole.h"
#include "Roles/Central/PodNetwork.h"
#include "Roles/Central/PhoneConfig.h"
#include "Program/ProgramCatalog.h"
#include "ColorSet/ColorSet.h"

class CommunicateBlock;

/**
 * CENTRAL role.
 *
 *   MENU       program menu, phone config via BLE (settings, program upload/download).
 *              Long press (or "select" via serial) selects a program. Without programs:
 *              red blinking, upload possible.
 *   DISCOVERY  ESP-NOW on, BLE stays connected (liveBle, ADR 0005). Claims peripherals until
 *              the program has enough (blue progress bar).
 *   CONFIRM    all green. A press (or "start" via serial / BLE) starts the program.
 *              In DISCOVERY, CONFIRM and PAUSED the program stores of all pods are synced.
 *              Program files cannot be changed from DISCOVERY on (busy).
 *   RUN        block engine runs. Report events go out over BLE as well as USB.
 *   PAUSED     a peripheral stopped answering: all yellow. When it is back, the current
 *              block is restarted (re-arms the pods) and the game continues.
 *              phonePaused: the client paused it ("pause", RUN only). Then the game does not
 *              continue by itself; "resume" ends it, and a peripheral lost meanwhile still
 *              holds it (config-api.md §5).
 *   ERROR      red blinking: program error or radio failure.
 *
 * Every state change is reported as {"event":"state",...} on the serial console.
 */
class CentralRole : public IRole {
    public:
        CentralRole();
        void run() override;

        const char* name() const override { return "central"; }
        void describe(JsonObject status) override;
        bool control(const char* op, JsonObjectConst request, JsonDocument& response) override;
        bool storeEditable() const override;
        bool engineIdle() const override;
        // MENU, CONFIRM and ERROR: no game timing, a press or a frame is seen within 1 ms
        bool idle() const override { return this->state == State::MENU || this->state == State::CONFIRM || this->state == State::ERROR; }
        // the menu without a phone: nobody is configuring the pod, and no game is prepared
        bool powerOffAllowed() const override { return this->state == State::MENU && !this->phone.connected(); }

    private:
        enum class State : uint8_t { MENU, DISCOVERY, CONFIRM, RUN, PAUSED, ERROR };

        static const uint8_t MAX_PERIPHERALS = 7;

        static const char* stateName(State state);
        void setState(State state);

        bool runModelSelector();
        void reloadMenu();
        bool startProgram();
        bool startGame();
        // a game does not start while the central or a pod is below Battery::CRITICAL_PERCENT (#19)
        bool batteryTooLow() const;
        void refuseStart();
        void drawProgress();
        void fail(const char* message);

        void opPrograms(JsonDocument& response);
        void opSelect(JsonObjectConst request, JsonDocument& response);
        void opStart(JsonDocument& response);
        void opEffect(JsonObjectConst request, JsonDocument& response);
        void opBlink(JsonObjectConst request, JsonDocument& response);
        void endBlink();
        void opReports(JsonObjectConst request, JsonDocument& response);
        void opAck(JsonObjectConst request, JsonDocument& response);
        void opCommand(JsonObjectConst request, JsonDocument& response);
        void opSetVariables(JsonObjectConst request, JsonDocument& response);
        void opSession(JsonObjectConst request, JsonDocument& response);
        void opPause(JsonDocument& response);
        void opResume(JsonDocument& response);
        void continueRun();
        // the communicate block that waits for the client; none while PAUSED (programs.md §7.16)
        CommunicateBlock* waitingBlock() const;

        State state = State::MENU;
        bool phonePaused = false;          // PAUSED by "pause"; only "resume" ends it
        ProgramCatalog catalog;
        PhoneConfig phone;
        PodNetwork network;
        uint32_t menuStoreHash = 0;

        // program menu
        uint64_t modelSelectorPressStart = 0;
        uint8_t modelSelectorCounter = 0;
        ColorSet modelSelectorColor = {0, 0, 0};
        uint8_t selectedModel = 0;
        bool waitForBootRelease = false;   // button still held from selecting CENTRAL at boot

        uint8_t requiredPeripherals = 0;
        int16_t drawnPodCount = -1;
        uint32_t pressCountAtConfirm = 0;
        int64_t refusedUntilUs = 0;        // CONFIRM: red after a refused start until this time, then green again

        int64_t blinkEndUs = 0;            // "blink" of the central itself ends here (0 = not blinking)
        int64_t rebootAtUs = 0;            // "stop": reboot into the menu shortly after answering
};
