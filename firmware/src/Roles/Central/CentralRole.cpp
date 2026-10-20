#include "CentralRole.h"
#include "Config/Console.h"
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/ErrorAnimation.h"
#include "BlockManager/BlockManager.h"
#include "VariableManager/VariableManager.h"
#include "Input/Button.h"
#include "Settings/Settings.h"
#include "Store/ProgramStore.h"
#include "Config/ConfigApi.h"
#include "Config/SerialConsole.h"
#include "Diagnostics/Diag.h"

CentralRole::CentralRole() {
    // the button was held to select CENTRAL at boot; that hold must not count as a menu press
    this->waitForBootRelease = digitalRead(PIN_BUTTON_PRESS) == LOW;

    this->phone.start();

    this->reloadMenu();
}

const char* CentralRole::stateName(State state) {
    switch(state) {
        case State::MENU: return "MENU";
        case State::DISCOVERY: return "DISCOVERY";
        case State::CONFIRM: return "CONFIRM";
        case State::RUN: return "RUN";
        case State::PAUSED: return "PAUSED";
        case State::ERROR: return "ERROR";
    }
    return "?";
}

void CentralRole::setState(State state) {
    this->state = state;

    JsonDocument event;
    event["event"] = "state";
    event["state"] = stateName(state);
    if(state != State::MENU && this->catalog.size() > 0) {
        event["program"] = this->catalog.get(this->selectedModel).path;
    }
    event["pods"] = this->network.podCount();
    event["required"] = this->requiredPeripherals;
    SerialConsole::emit(event);
}

void CentralRole::reloadMenu() {
    this->menuStoreHash = ProgramStore::get().hash();
    if(!this->catalog.load()) {
        // stay in the menu: programs can still be uploaded via the config API
        Console.println("No programs found - upload them via the config API or 'pio run -t uploadfs'");
        return;
    }
    if(this->selectedModel >= this->catalog.size()) {
        this->selectedModel = 0;
    }
    this->catalog.showMenu(this->selectedModel, *LEDManager::getManager());
}

void CentralRole::fail(const char* message) {
    Console.println(message);
    this->setState(State::ERROR);
}

void CentralRole::run() {
    if(this->rebootAtUs != 0 && esp_timer_get_time() >= this->rebootAtUs) {
        Console.flush();
        esp_restart();
    }

    Button::get().update();
    if(this->state != State::MENU && this->state != State::ERROR) {
        this->network.service();
    }

    switch(this->state) {
        case State::MENU:
            this->phone.service();
            if(ProgramStore::get().hash() != this->menuStoreHash) {
                this->reloadMenu();     // programs changed via BLE or serial
            }
            if(this->catalog.size() == 0) {
                LEDManager::getManager()->setLEDColors(errorPattern);
                break;
            }
            if(this->runModelSelector() && this->startProgram()) {
                this->setState(State::DISCOVERY);
            }
            break;

        case State::DISCOVERY:
            this->drawProgress();
            if(this->network.podCount() >= this->requiredPeripherals) {
                this->network.setAcceptNewPods(false, this->requiredPeripherals);
                Console.printf("Connected to %d peripherals\n", this->network.podCount());
                LEDManager::getManager()->setLEDColors(GREEN);
                this->pressCountAtConfirm = Button::get().pressCount();
                this->setState(State::CONFIRM);
            }
            break;

        case State::CONFIRM:
            if(Button::get().pressCount() != this->pressCountAtConfirm) {
                this->startGame();
            }
            break;

        case State::RUN:
            if(!this->network.allAlive()) {
                Console.println("Peripheral lost, game paused");
                LEDManager::getManager()->setLEDColors(YELLOW);
                this->network.setSyncAllowed(true);
                this->setState(State::PAUSED);
                break;
            }
            BlockManager::getManager()->run();
            break;

        case State::PAUSED:
            if(this->network.allAlive()) {
                Console.println("All peripherals back, game continues");
                LEDManager::getManager()->turnOff();
                this->network.setSyncAllowed(false);
                BlockManager::getManager()->restartCurrentBlock();
                this->setState(State::RUN);
            }
            break;

        case State::ERROR:
            LEDManager::getManager()->setLEDColors(errorPattern);
            break;
    }
}

bool CentralRole::startProgram() {
    const ProgramCatalog::ProgramInfo& program = this->catalog.get(this->selectedModel);
    Console.printf("Program selected: %s (%s)\n", program.name.c_str(), program.path.c_str());

    BlockManager* bm = BlockManager::getManager();
    Diag::step("select: load program");
    if(!bm->loadProgram(program.path.c_str())) {
        Console.printf("Program could not be loaded: %s\n", bm->getLastError().c_str());
        this->fail("Program error");
        return false;
    }

    VariableManager* vars = VariableManager::getManager();
    int64_t maxLoops;
    if(this->phone.getMaxLoops(maxLoops)) {
        vars->setVariable("MAX_LOOPS", maxLoops);
        Console.printf("MAX_LOOPS set by phone: %lld\n", maxLoops);
    }

    int64_t required = vars->getVariable("REQUIRED_PERIPHERALS");
    this->requiredPeripherals = (uint8_t)constrain(required, (int64_t)0, (int64_t)MAX_PERIPHERALS);

    // the phone is only needed in the menu; free the radio for the pod link
    Diag::step("select: BLE stop");
    this->phone.stop();

    if(this->requiredPeripherals == 0) {
        return true;    // central only, no radio needed
    }
    Diag::step("select: set id");
    uint32_t setId = Settings::getOrCreateSetId();
    Diag::step("select: radio start");
    if(!this->network.begin(setId)) {
        this->fail("Radio (ESP-NOW) could not be started");
        return false;
    }
    this->network.setAcceptNewPods(true, this->requiredPeripherals);
    this->drawnPodCount = -1;
    Diag::step("loop");
    return true;
}

bool CentralRole::startGame() {
    Console.println("Confirmed, starting program");
    LEDManager::getManager()->turnOff();

    // drop presses that arrived before the game started
    PodEvent stale;
    while(this->network.pollEvent(stale)) {}

    if(!BlockManager::getManager()->start(&this->network)) {
        this->fail("Program could not be started");
        return false;
    }
    this->network.setSyncAllowed(false);    // keep the link free for the game
    this->setState(State::RUN);
    return true;
}

void CentralRole::drawProgress() {
    uint8_t connected = this->network.podCount();
    if(connected == this->drawnPodCount) {
        return;
    }
    this->drawnPodCount = connected;

    LEDManager* led = LEDManager::getManager();
    led->turnOff();
    for(uint8_t i = 0; i < this->requiredPeripherals; i++) {
        led->setLEDColors(2*i, BLUE);
        led->setLEDColors(2*i+1, i < connected ? BLUE : BLACK);
    }
}

bool CentralRole::runModelSelector() {

    auto buttonPressed = digitalRead(PIN_BUTTON_PRESS) == LOW;

    if(this->waitForBootRelease) {
        if(!buttonPressed) {
            this->waitForBootRelease = false;
        }
        return false;
    }

    if(buttonPressed) {
        if(this->modelSelectorCounter == 0) {
            this->modelSelectorPressStart = millis();
            this->modelSelectorCounter++;
        } else {
            // the counter increases every ~10 ms while the button is held
            if(this->modelSelectorPressStart + this->modelSelectorCounter*10 < millis()) {
                this->modelSelectorCounter++;

                this->modelSelectorColor.red = this->modelSelectorCounter;
                this->modelSelectorColor.green = this->modelSelectorCounter;
                this->modelSelectorColor.blue = this->modelSelectorCounter;

                //increase brightness of selection LED
                LEDManager* led = LEDManager::getManager();
                led->setLEDColors(16 , &this->modelSelectorColor);
                led->setLEDColors(17 , &this->modelSelectorColor);
                led->setLEDColors(0 , &this->modelSelectorColor);
                led->setLEDColors(1 , &this->modelSelectorColor);
                led->setLEDColors(2 , &this->modelSelectorColor);

                if(this->modelSelectorCounter > 180) {
                    // long press (~1.8 s): program selected
                    led->turnOff();
                    return true;
                }
            }

        }
    } else {
        //trigger on release
        if(this->modelSelectorCounter > 0 && this->modelSelectorCounter <= 100) {
            // short press: next program
            this->selectedModel = (this->selectedModel + 1) % this->catalog.size();
        }
        if(this->modelSelectorCounter > 0) {
            // redraw after every release, also to remove the brightness ramp of an aborted long press
            this->catalog.showMenu(this->selectedModel, *LEDManager::getManager());
        }

        this->modelSelectorCounter = 0;
        this->modelSelectorPressStart = 0;
    }

    return false;
}

// ---------------------------------------------------------------- configuration API

bool CentralRole::storeEditable() const {
    if(this->state == State::RUN) {
        return false;
    }
    return !this->network.isSyncing();
}

bool CentralRole::engineIdle() const {
    return this->state == State::MENU || this->state == State::ERROR;
}

void CentralRole::describe(JsonObject status) {
    status["state"] = stateName(this->state);

    if(this->catalog.size() > 0) {
        const ProgramCatalog::ProgramInfo& program = this->catalog.get(this->selectedModel);
        JsonObject p = status["program"].to<JsonObject>();
        p["index"] = this->selectedModel;
        p["name"] = program.name;
        p["path"] = program.path;
        p["selected"] = this->state != State::MENU;
    }

    status["requiredPeripherals"] = this->requiredPeripherals;
    status["radio"] = this->network.isStarted();
    status["syncing"] = this->network.isSyncing();
    this->network.describe(status["pods"].to<JsonArray>());

    if(this->state == State::RUN || this->state == State::PAUSED) {
        status["block"] = BlockManager::getManager()->currentBlockName();
        JsonObject timers = status["timers"].to<JsonObject>();
        timers["orphanStops"] = BlockManager::getManager()->timerOrphanStops();
    }
    if(this->state != State::MENU) {
        VariableManager* vars = VariableManager::getManager();
        JsonObject v = status["variables"].to<JsonObject>();
        for(size_t i = 0; i < vars->count(); i++) {
            v[vars->name((VarId)i)] = vars->get((VarId)i);
        }
    }
}

bool CentralRole::control(const char* op, JsonObjectConst request, JsonDocument& response) {
    if(strcmp(op, "programs") == 0) {
        this->opPrograms(response);
    } else if(strcmp(op, "select") == 0) {
        this->opSelect(request, response);
    } else if(strcmp(op, "start") == 0) {
        this->opStart(response);
    } else if(strcmp(op, "press") == 0) {
        Button::get().simulatePress();
        response["ok"] = true;
        response["state"] = stateName(this->state);
    } else if(strcmp(op, "stop") == 0) {
        // back to the program menu: restart as central (answer first)
        Settings::setBootRole(1);
        this->rebootAtUs = esp_timer_get_time() + 300000;
        response["ok"] = true;
    } else {
        return false;
    }
    return true;
}

void CentralRole::opPrograms(JsonDocument& response) {
    response["ok"] = true;
    response["selected"] = this->selectedModel;
    JsonArray list = response["programs"].to<JsonArray>();
    for(size_t i = 0; i < this->catalog.size(); i++) {
        const ProgramCatalog::ProgramInfo& program = this->catalog.get(i);
        JsonObject p = list.add<JsonObject>();
        p["index"] = i;
        p["name"] = program.name;
        p["path"] = program.path;
        p["peripherals"] = program.peripherals;
    }
}

void CentralRole::opSelect(JsonObjectConst request, JsonDocument& response) {
    if(this->state != State::MENU) {
        ConfigApi::setError(response, "busy", String("a program is already selected (state ") + stateName(this->state) + "), use 'stop' first");
        return;
    }
    if(this->catalog.size() == 0) {
        ConfigApi::setError(response, "not_found", "no programs on this pod");
        return;
    }

    JsonVariantConst which = request["program"];
    int index = -1;
    if(which.is<int>()) {
        index = which.as<int>();
    } else if(which.is<const char*>()) {
        const char* key = which.as<const char*>();
        for(size_t i = 0; i < this->catalog.size(); i++) {
            const ProgramCatalog::ProgramInfo& program = this->catalog.get(i);
            if(program.path == key || strcasecmp(program.name.c_str(), key) == 0) {
                index = (int)i;
                break;
            }
        }
    }
    if(index < 0 || index >= (int)this->catalog.size()) {
        ConfigApi::setError(response, "not_found", "unknown program (use an index, path or name from 'programs')");
        return;
    }

    this->selectedModel = (uint8_t)index;
    if(!this->startProgram()) {
        ConfigApi::setError(response, "invalid_program", BlockManager::getManager()->getLastError());
        return;
    }
    this->setState(State::DISCOVERY);

    const ProgramCatalog::ProgramInfo& program = this->catalog.get(this->selectedModel);
    response["ok"] = true;
    response["index"] = index;
    response["name"] = program.name;
    response["path"] = program.path;
    response["requiredPeripherals"] = this->requiredPeripherals;
}

void CentralRole::opStart(JsonDocument& response) {
    switch(this->state) {
        case State::CONFIRM:
            if(this->startGame()) {
                response["ok"] = true;
                response["state"] = stateName(this->state);
            } else {
                ConfigApi::setError(response, "invalid_program", BlockManager::getManager()->getLastError());
            }
            return;
        case State::DISCOVERY:
            ConfigApi::setError(response, "not_ready", String(this->network.podCount()) + " of "
                                + String(this->requiredPeripherals) + " peripherals connected");
            return;
        case State::MENU:
            ConfigApi::setError(response, "not_ready", "no program selected (use 'select')");
            return;
        default:
            ConfigApi::setError(response, "busy", String("state is ") + stateName(this->state));
            return;
    }
}
