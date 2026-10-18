#include "CentralMode.h"

std::map<BLERemoteCharacteristic*, Peripheral*> CentralMode::notifyMap;

CentralMode::CentralMode() {

    this->centralState = BLECentralState::WAITING_FOR_MODEL_SELECTION;
    this->eventQueue = xQueueCreate(32, sizeof(PodEvent));
    this->modelSelectorColor = new ColorSet{0,0,0};

    // the button was held to select CENTRAL at boot; that hold must not count as a menu press
    this->waitForBootRelease = digitalRead(PIN_BUTTON_PRESS) == LOW;

    this->startConfigurationBLE();

    if(!this->catalog.load()) {
        Serial.println("No programs found on the file system");
        this->centralState = BLECentralState::ERROR;
        return;
    }
    this->catalog.showMenu(this->selectedModel, *LEDManager::getManager());
}

void CentralMode::runMode() {
    // The central state machine has the following modes:
    // 1. Waiting for the program to be selected
    // 2. Waiting for the required number of peripherals to be connected
    // 3. Confirm
    // 4. Run the block manager

    switch(this->centralState) {
        case BLECentralState::WAITING_FOR_MODEL_SELECTION:
        {
            if(this->runModelSelector()) {
                if(this->loadSelectedProgram()) {
                    this->centralState = BLECentralState::WAITING_FOR_PERIPHERALS;
                    int64_t required = VariableManager::getManager()->getVariable("REQUIRED_PERIPHERALS");
                    this->requiredPeripherals = (uint8_t)constrain(required, (int64_t)0, (int64_t)MAX_PERIPHERALS);
                    this->connectedPeripherals = 0;
                } else {
                    this->centralState = BLECentralState::ERROR;
                }
            }

            break;
        }
        case BLECentralState::WAITING_FOR_PERIPHERALS:
            {

                BLEDevice::init("ReactPod Running");
                LEDManager* led = LEDManager::getManager();
                led->turnOff();

                //set LEDs for progress bar
                for(uint8_t i = 0; i < this->requiredPeripherals; i++) {
                    led->setLEDColors(2*i, BLUE);
                    if(i < this->connectedPeripherals) {
                        led->setLEDColors(2*i+1, BLUE);
                    } else {
                        led->setLEDColors(2*i+1, BLACK);
                    }
                }
                // In this state, the central is waiting for the required number of peripherals to be connected
                if(this->connectedPeripherals < this->requiredPeripherals) {
                    this->clientScanForPeripherals();
                } else {
                    BLEScan* pBLEScan = BLEDevice::getScan();
                    pBLEScan->stop(); // Stop the scan once we have the required number of peripherals
                    Serial.printf("Connected to %d peripherals\n", this->connectedPeripherals);
                    this->centralState = BLECentralState::CONFIRM;
                }
                break;
            }
        case BLECentralState::CONFIRM:
        {
            LEDManager::getManager()->setLEDColors(GREEN);

            //check the max loop parameter written by the phone
            std::string value = this->maxLoopCharacteristic->getValue();
            char* end = nullptr;
            long long setValue = strtoll(value.c_str(), &end, 10);
            if(end != value.c_str() && *end == '\0' && setValue > 0) {
                VariableManager::getManager()->setVariable("MAX_LOOPS", setValue);
            }

            if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                Serial.println("Confirmed connection with peripherals");
                LEDManager::getManager()->turnOff();

                // drop notifications that arrived before the game started
                PodEvent stale;
                while(this->pollEvent(stale)) {}

                if(BlockManager::getManager()->start(this)) {
                    this->centralState = BLECentralState::RUN_BLOCK_MANAGER;
                } else {
                    this->centralState = BLECentralState::ERROR;
                }
            }
            break;
        }
        case BLECentralState::RUN_BLOCK_MANAGER:
        {
            //check if all peripherals are still connected
            for(uint8_t i = 0; i < this->connectedPeripherals; i++) {
                if(!this->peripherals[i]->isConnected()) {
                    Serial.printf("Peripheral %d disconnected\n", i);
                    this->centralState = BLECentralState::ERROR;
                    return;
                }
            }

            BlockManager::getManager()->run();
            break;
        }
        case BLECentralState::ERROR:
        {
            LEDManager::getManager()->setLEDColors(errorPattern);
            break;
        }
    }
}

bool CentralMode::loadSelectedProgram() {
    const ProgramCatalog::ProgramInfo& program = this->catalog.get(this->selectedModel);
    Serial.printf("Program selected: %s (%s)\n", program.name.c_str(), program.path.c_str());

    if(!BlockManager::getManager()->loadProgram(program.path.c_str())) {
        Serial.printf("Program could not be loaded: %s\n", BlockManager::getManager()->getLastError().c_str());
        return false;
    }
    return true;
}

void CentralMode::clientScanForPeripherals() {
    BLEScan* pBLEScan = BLEDevice::getScan();
    Serial.println("Starting BLE scan...");
    pBLEScan->setActiveScan(true);
    BLEScanResults foundDevices = pBLEScan->start(2, false);
    Serial.println("Scan complete");

    for (int i = 0; i < foundDevices.getCount() && this->connectedPeripherals < this->requiredPeripherals; i++) {

        BLEAdvertisedDevice advertisedDevice = foundDevices.getDevice(i);

        if (!advertisedDevice.haveServiceUUID() || !advertisedDevice.isAdvertisingService(BLEUUID(SERVICE_UUID))) {
            continue;
        }
        Serial.printf("Found device: %s\n", advertisedDevice.getAddress().toString().c_str());

        Peripheral* peripheral = new Peripheral(advertisedDevice, this->connectedPeripherals, this);
        if (!peripheral->isValid()) {
            // connection failed or not a ReactPod peripheral (e.g. another central): do not count it
            peripheral->disconnect();
            continue;
        }

        this->peripherals[this->connectedPeripherals] = peripheral;
        this->connectedPeripherals++;
    }
    pBLEScan->clearResults();
}


bool CentralMode::runModelSelector() {

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

                this->modelSelectorColor->red = this->modelSelectorCounter;
                this->modelSelectorColor->green = this->modelSelectorCounter;
                this->modelSelectorColor->blue = this->modelSelectorCounter;

                //increase brightness of selection LED
                LEDManager::getManager()->setLEDColors(16 , this->modelSelectorColor);
                LEDManager::getManager()->setLEDColors(17 , this->modelSelectorColor);
                LEDManager::getManager()->setLEDColors(0 , this->modelSelectorColor);
                LEDManager::getManager()->setLEDColors(1 , this->modelSelectorColor);
                LEDManager::getManager()->setLEDColors(2 , this->modelSelectorColor);

                if(this->modelSelectorCounter > 180) {
                    // long press (~1.8 s): program selected
                    LEDManager::getManager()->turnOff();
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

Peripheral* CentralMode::getPeripheral(uint8_t peripheralId) {
    if (peripheralId < this->connectedPeripherals) {
        return this->peripherals[peripheralId];
    }
    return nullptr; // Return nullptr if the peripheralId is out of bounds
}

void CentralMode::startConfigurationBLE() {
    BLEDevice::deinit(true);   // true = release memory
    BLEDevice::init("ReactPod Config");
    BLEServer *pServer = BLEDevice::createServer();
    BLEService *pService = pServer->createService(SERVICE_UUID);

    // Action Mode characteristic (writable by client)
    this->maxLoopCharacteristic= pService->createCharacteristic(
        CHAR_MAX_LOOP_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );
    this->maxLoopCharacteristic->setValue(std::to_string(-1));

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

}

void CentralMode::subscribeNotify(BLERemoteCharacteristic* pChar , Peripheral* peripheral) {
    CentralMode::notifyMap[pChar] = peripheral;
    pChar->registerForNotify(CentralMode::notifyCallback);
}

void CentralMode::notifyCallback(
    BLERemoteCharacteristic* pChar,
    uint8_t* pData, size_t length, bool isNotify
) {
    auto it = CentralMode::notifyMap.find(pChar);
    if (it != CentralMode::notifyMap.end()) {
        it->second->handleNotify(pChar, pData, length, isNotify);
    }
}

// runs in the BLE task: hand the event to the main loop through the queue
void CentralMode::handleNotify(Peripheral* peripheral) {
    PodEvent event{peripheral->getId(), peripheral->lastResult, (uint32_t)millis()};
    if (xQueueSend(this->eventQueue, &event, 0) != pdTRUE) {
        Serial.println("Event queue full, notification dropped");
    }
}

bool CentralMode::pollEvent(PodEvent& event) {
    return xQueueReceive(this->eventQueue, &event, 0) == pdTRUE;
}
