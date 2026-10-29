#include "CentralRole.h"
#include "Config/Console.h"
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/ErrorAnimation.h"
#include "LEDManager/EffectJson.h"
#include "BlockManager/BlockManager.h"
#include "VariableManager/VariableManager.h"
#include "Input/Button.h"
#include "Settings/Settings.h"
#include "Store/ProgramStore.h"
#include "Config/ConfigApi.h"
#include "Config/SerialConsole.h"
#include "Diagnostics/Diag.h"
#include "Results/Reports.h"
#include "Block/CommunicateBlock/CommunicateBlock.h"

CentralRole::CentralRole() {
    // the button was held to select CENTRAL at boot; that hold must not count as a menu press
    this->waitForBootRelease = Button::get().isDown();

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

    // BLE requests are handled in every state: the phone stays connected during the game (liveBle)
    this->phone.service();

    switch(this->state) {
        case State::MENU:
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

    // BLE stays on (liveBle, ADR 0005): the phone keeps its connection and gets the game interval
    Diag::step("select: BLE game mode");
    this->phone.enterGame();

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

    // the report log and the cycle counter belong to this program run
    Reports::get().beginProgram(this->catalog.get(this->selectedModel).path.c_str(),
                                Settings::getOrCreateSetId(), millis());

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

    // debounced driver (updated once per loop pass in run()), same as the game blocks
    bool buttonPressed = Button::get().isDown();

    if(this->waitForBootRelease) {
        if(!buttonPressed) {
            this->waitForBootRelease = false;
        }
        return false;
    }

    if(buttonPressed) {
        if(this->modelSelectorCounter == 0) {
            this->modelSelectorPressStart = Button::get().lastPressTime();
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
    // program files change in the menu (and after an error) only: not while a game is prepared, runs or is paused
    if(this->state != State::MENU && this->state != State::ERROR) {
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
    this->phone.describe(status["ble"].to<JsonObject>());
    status["radio"] = this->network.isStarted();
    status["syncing"] = this->network.isSyncing();
    status["athlete"] = Reports::get().athlete();
    JsonObject reports = status["reports"].to<JsonObject>();
    reports["pending"] = (uint32_t)Reports::get().pending();
    reports["dropped"] = Reports::get().droppedReports();
    if(CommunicateBlock* waiting = this->waitingBlock()) {
        JsonObject w = status["waiting"].to<JsonObject>();
        w["block"] = waiting->getName();
        JsonObject editable = w["editable"].to<JsonObject>();
        VariableManager* vars = VariableManager::getManager();
        for(const CommunicateBlock::Editable& e : waiting->editable()) {
            JsonObject m = editable[e.name].to<JsonObject>();
            m["min"] = e.min;
            m["max"] = e.max;
            m["value"] = vars->get(e.var);
        }
    }
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
    } else if(strcmp(op, "effect") == 0) {
        this->opEffect(request, response);
    } else if(strcmp(op, "reports") == 0) {
        this->opReports(request, response);
    } else if(strcmp(op, "ack") == 0) {
        this->opAck(request, response);
    } else if(strcmp(op, "command") == 0) {
        this->opCommand(request, response);
    } else if(strcmp(op, "setVariables") == 0) {
        this->opSetVariables(request, response);
    } else if(strcmp(op, "session") == 0) {
        this->opSession(request, response);
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

// Test op: plays an effect on the central ("target": "self", default), on one pod (its id),
// on all pods ("pods") or on both ("all"), all with the same start time (now + delayMs).
// Pods without effect support are listed in "skipped".
void CentralRole::opEffect(JsonObjectConst request, JsonDocument& response) {
    if(this->state == State::RUN || this->state == State::PAUSED) {
        ConfigApi::setError(response, "busy", String("state is ") + stateName(this->state));
        return;
    }
    Protocol::EffectDesc effect;
    String error;
    if(!EffectJson::parse(request, effect, error)) {
        ConfigApi::setError(response, "bad_request", error);
        return;
    }

    JsonVariantConst target = request["target"];
    bool self = target.isNull() || target == "self" || target == "all";
    bool allPods = target == "pods" || target == "all";
    int onePod = target.is<int>() ? target.as<int>() : -1;
    if(!self && !allPods && (onePod < 0 || onePod >= this->network.podCount())) {
        ConfigApi::setError(response, "bad_request", "'target' must be \"self\", \"pods\", \"all\" or a connected pod id");
        return;
    }
    if((allPods || onePod >= 0) && !this->network.isStarted()) {
        ConfigApi::setError(response, "not_ready", "radio is off (select a program first)");
        return;
    }

    // pods need a common start time in the future to run in step
    uint32_t delayMs = request["delayMs"] | (allPods || onePod >= 0 ? 50u : 0u);
    int64_t startAtUs = delayMs != 0 ? this->network.nowUs() + (int64_t)delayMs * 1000 : 0;

    JsonArray sent = response["sent"].to<JsonArray>();
    JsonArray skipped = response["skipped"].to<JsonArray>();
    for(uint8_t i = 0; i < this->network.podCount(); i++) {
        if(allPods || i == onePod) {
            if(this->network.effect(i, effect, startAtUs)) {
                sent.add(i);
            } else {
                skipped.add(i);     // older firmware: no effects
            }
        }
    }
    if(self) {
        LEDManager::getManager()->playEffect(effect, startAtUs);   // network time = local time on the central
    }
    response["ok"] = true;
    response["effect"] = LEDManager::effectName(effect.effect);
    response["startAtUs"] = startAtUs;
}

// Report buffer: every report not acknowledged yet, oldest first. Paging (optional, for BLE):
// "from" = index into the unacknowledged reports (default 0), "max" = how many (default all).
// Without either field all reports are returned, as before. "total" = all unacknowledged reports,
// "more" = true if reports follow this page. After an ack the indexes move: ack the page first.
void CentralRole::opReports(JsonObjectConst request, JsonDocument& response) {
    JsonVariantConst fromValue = request["from"];
    JsonVariantConst maxValue = request["max"];
    if((!fromValue.isNull() && !fromValue.is<int64_t>()) || (!maxValue.isNull() && !maxValue.is<int64_t>())) {
        ConfigApi::setError(response, "bad_request", "'from' and 'max' must be numbers");
        return;
    }
    const std::vector<Reports::Report>& all = Reports::get().reports();
    size_t total = all.size();
    size_t from = fromValue.isNull() ? 0 : (size_t)constrain(fromValue.as<int64_t>(), (int64_t)0, (int64_t)total);
    size_t count = total - from;
    if(!maxValue.isNull()) {
        count = (size_t)constrain(maxValue.as<int64_t>(), (int64_t)0, (int64_t)count);
    }

    response["ok"] = true;
    response["total"] = (uint32_t)total;
    response["more"] = from + count < total;
    JsonArray list = response["reports"].to<JsonArray>();
    for(size_t i = from; i < from + count; i++) {
        Reports::write(all[i], list.add<JsonObject>());
    }
}

void CentralRole::opAck(JsonObjectConst request, JsonDocument& response) {
    JsonVariantConst id = request["reportId"];
    if(!id.is<int64_t>() || id.as<int64_t>() < 0) {
        ConfigApi::setError(response, "bad_request", "'reportId' must be a report id (number)");
        return;
    }
    Reports::get().ack((uint32_t)id.as<int64_t>());
    response["ok"] = true;
    response["pending"] = (uint32_t)Reports::get().pending();
}

// Answers the waiting communicate block (programs.md §7.16)
void CentralRole::opCommand(JsonObjectConst request, JsonDocument& response) {
    const char* name = request["name"] | "";
    CommunicateBlock::Command command = CommunicateBlock::Command::NONE;
    if(strcmp(name, "continue") == 0) command = CommunicateBlock::Command::CONTINUE;
    else if(strcmp(name, "repeat") == 0) command = CommunicateBlock::Command::REPEAT;
    else if(strcmp(name, "stop") == 0) command = CommunicateBlock::Command::STOP;
    else {
        ConfigApi::setError(response, "bad_request", "'name' must be continue, repeat or stop");
        return;
    }
    CommunicateBlock* waiting = this->waitingBlock();
    if(waiting == nullptr) {
        ConfigApi::setError(response, "not_ready", "no communicate block waits");
        return;
    }
    waiting->command(command);
    response["ok"] = true;
    response["name"] = name;
}

// All or nothing: every value is checked before the first one is written
void CentralRole::opSetVariables(JsonObjectConst request, JsonDocument& response) {
    CommunicateBlock* waiting = this->waitingBlock();
    if(waiting == nullptr) {
        ConfigApi::setError(response, "not_ready", "no communicate block waits");
        return;
    }
    JsonVariantConst values = request["values"];
    if(!values.is<JsonObjectConst>()) {
        ConfigApi::setError(response, "bad_request", "'values' must be an object: name -> integer");
        return;
    }

    const std::vector<CommunicateBlock::Editable>& editable = waiting->editable();
    auto findEditable = [&editable](const std::string& name) -> const CommunicateBlock::Editable* {
        for(const CommunicateBlock::Editable& e : editable) {
            if(e.name == name) return &e;
        }
        return nullptr;
    };

    for(JsonPairConst pair : values.as<JsonObjectConst>()) {
        std::string name = pair.key().c_str();
        if(!pair.value().is<int64_t>()) {
            ConfigApi::setError(response, "bad_request", "'" + String(name.c_str()) + "' must be an integer");
            return;
        }
        const CommunicateBlock::Editable* e = findEditable(name);
        if(e == nullptr) {
            ConfigApi::setError(response, "not_editable", "'" + String(name.c_str()) + "' is not editable now");
            return;
        }
        int64_t value = pair.value().as<int64_t>();
        if(value < e->min || value > e->max) {
            ConfigApi::setError(response, "out_of_range", "'" + String(name.c_str()) + "' must be within "
                                + String((int32_t)e->min) + " ... " + String((int32_t)e->max));
            return;
        }
    }

    VariableManager* vars = VariableManager::getManager();
    JsonObject out = response["variables"].to<JsonObject>();
    for(JsonPairConst pair : values.as<JsonObjectConst>()) {
        std::string name = pair.key().c_str();
        const CommunicateBlock::Editable* e = findEditable(name);
        int64_t value = pair.value().as<int64_t>();
        vars->set(e->var, value);
        out[name] = vars->get(e->var);
    }
    response["ok"] = true;
}

CommunicateBlock* CentralRole::waitingBlock() const {
    return this->state == State::RUN ? CommunicateBlock::waiting() : nullptr;
}

// Athlete id of the following reports. Allowed before a game and while a communicate block waits.
void CentralRole::opSession(JsonObjectConst request, JsonDocument& response) {
    bool idle = this->state == State::MENU || this->state == State::DISCOVERY || this->state == State::CONFIRM;
    if(!idle && this->waitingBlock() == nullptr) {
        ConfigApi::setError(response, "busy", String("state is ") + stateName(this->state));
        return;
    }
    JsonVariantConst athlete = request["athlete"];
    if(!athlete.is<const char*>()) {
        ConfigApi::setError(response, "bad_request", "'athlete' must be a string (\"\" clears it)");
        return;
    }
    std::string id = athlete.as<const char*>();
    if(id.length() > Reports::MAX_ATHLETE) {
        ConfigApi::setError(response, "bad_request", "'athlete' longer than 40 bytes");
        return;
    }
    Reports::get().setAthlete(id);
    response["ok"] = true;
    response["athlete"] = id;
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
