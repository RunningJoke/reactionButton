#include "CentralRole.h"
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/ErrorAnimation.h"
#include "BlockManager/BlockManager.h"
#include "VariableManager/VariableManager.h"
#include "Input/Button.h"
#include "Settings/Settings.h"

CentralRole::CentralRole() {
    // the button was held to select CENTRAL at boot; that hold must not count as a menu press
    this->waitForBootRelease = digitalRead(PIN_BUTTON_PRESS) == LOW;

    this->phone.start();

    this->reloadMenu();
}

void CentralRole::reloadMenu() {
    if(!this->catalog.load()) {
        // stay in the menu: programs can still be uploaded via the phone API
        Serial.println("No programs found - upload them via the config API or 'pio run -t uploadfs'");
        return;
    }
    if(this->selectedModel >= this->catalog.size()) {
        this->selectedModel = 0;
    }
    this->catalog.showMenu(this->selectedModel, *LEDManager::getManager());
}

void CentralRole::fail(const char* message) {
    Serial.println(message);
    this->state = State::ERROR;
}

void CentralRole::run() {
    Button::get().update();
    if(this->state != State::MENU && this->state != State::ERROR) {
        this->network.service();
    }

    switch(this->state) {
        case State::MENU:
            this->phone.service();
            if(this->phone.takeStoreChanged()) {
                this->reloadMenu();
            }
            if(this->catalog.size() == 0) {
                LEDManager::getManager()->setLEDColors(errorPattern);
                break;
            }
            if(this->runModelSelector() && this->startProgram()) {
                this->state = State::DISCOVERY;
            }
            break;

        case State::DISCOVERY:
            this->drawProgress();
            if(this->network.podCount() >= this->requiredPeripherals) {
                this->network.setAcceptNewPods(false, this->requiredPeripherals);
                Serial.printf("Connected to %d peripherals\n", this->network.podCount());
                LEDManager::getManager()->setLEDColors(GREEN);
                this->pressCountAtConfirm = Button::get().pressCount();
                this->state = State::CONFIRM;
            }
            break;

        case State::CONFIRM:
            if(Button::get().pressCount() != this->pressCountAtConfirm) {
                Serial.println("Confirmed, starting program");
                LEDManager::getManager()->turnOff();

                // drop presses that arrived before the game started
                PodEvent stale;
                while(this->network.pollEvent(stale)) {}

                if(BlockManager::getManager()->start(&this->network)) {
                    this->network.setSyncAllowed(false);    // keep the link free for the game
                    this->state = State::RUN;
                } else {
                    this->fail("Program could not be started");
                }
            }
            break;

        case State::RUN:
            if(!this->network.allAlive()) {
                Serial.println("Peripheral lost, game paused");
                LEDManager::getManager()->setLEDColors(YELLOW);
                this->network.setSyncAllowed(true);
                this->state = State::PAUSED;
                break;
            }
            BlockManager::getManager()->run();
            break;

        case State::PAUSED:
            if(this->network.allAlive()) {
                Serial.println("All peripherals back, game continues");
                LEDManager::getManager()->turnOff();
                this->network.setSyncAllowed(false);
                BlockManager::getManager()->restartCurrentBlock();
                this->state = State::RUN;
            }
            break;

        case State::ERROR:
            LEDManager::getManager()->setLEDColors(errorPattern);
            break;
    }
}

bool CentralRole::startProgram() {
    const ProgramCatalog::ProgramInfo& program = this->catalog.get(this->selectedModel);
    Serial.printf("Program selected: %s (%s)\n", program.name.c_str(), program.path.c_str());

    BlockManager* bm = BlockManager::getManager();
    if(!bm->loadProgram(program.path.c_str())) {
        Serial.printf("Program could not be loaded: %s\n", bm->getLastError().c_str());
        this->fail("Program error");
        return false;
    }

    VariableManager* vars = VariableManager::getManager();
    int64_t maxLoops;
    if(this->phone.getMaxLoops(maxLoops)) {
        vars->setVariable("MAX_LOOPS", maxLoops);
        Serial.printf("MAX_LOOPS set by phone: %lld\n", maxLoops);
    }

    int64_t required = vars->getVariable("REQUIRED_PERIPHERALS");
    this->requiredPeripherals = (uint8_t)constrain(required, (int64_t)0, (int64_t)MAX_PERIPHERALS);

    // the phone is only needed in the menu; free the radio for the pod link
    this->phone.stop();

    if(this->requiredPeripherals == 0) {
        return true;    // central only, no radio needed
    }
    if(!this->network.begin(Settings::getOrCreateSetId())) {
        this->fail("Radio (ESP-NOW) could not be started");
        return false;
    }
    this->network.setAcceptNewPods(true, this->requiredPeripherals);
    this->drawnPodCount = -1;
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
