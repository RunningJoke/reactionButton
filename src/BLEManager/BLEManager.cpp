#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"

#include "ErrorAnimation.h"

BLEManager* BLEManager::manager = nullptr;

std::map<BLERemoteCharacteristic*, Peripheral*> BLEManager::notifyMap;

BLEManager* BLEManager::getManager() {

    if(BLEManager::manager == nullptr) {        
        BLEManager::manager = new BLEManager();
    }

    return BLEManager::manager;
};

BLEManager::BLEManager() {
    this->modelSelectorColor = new ColorSet{0,0,0};
}

void BLEManager::runAsPeripheral() {

    switch(this->peripheralState) {
        case BLEPeripheralState::WAITING_FOR_CONNECTION:
            // In this state, the peripheral is waiting for a client to connect
            LEDManager::getManager()->setLEDColors(YELLOW);
            if(this->teamIdCharacteristic->getValue().length() > 0) {
                // If the team ID is set, we can transition to READY state
                this->peripheralState = BLEPeripheralState::CONNECTED;
                LEDManager::getManager()->turnOff();
            }
            break;
        case BLEPeripheralState::CONNECTED:
            // In this state, the peripheral is connected to a client and awaiting configuration
            Serial.println("Peripheral connected");
            this->peripheralState = BLEPeripheralState::READY;
            break;
        case BLEPeripheralState::READY:
            LEDManager::getManager()->setLEDColors(255);
            if(this->actionModeCharacteristic->getData()[0] != 0) {
                // If the action mode is set, we can transition to ACTIVE state
                Serial.println("Peripheral ready for action mode");
                this->peripheralState = BLEPeripheralState::ACTIVE; 
                this->peripheralTimer = millis(); 
            }
            break;
        case BLEPeripheralState::ACTIVE:
        {
            LEDManager::getManager()->setLEDColors((uint8_t)this->ledColorCharacteristic->getData()[0]);
            if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                Serial.println("Peripheral button hit");
                // If the button is pressed, we can transition to ACTIVE state
                this->peripheralState = BLEPeripheralState::WAIT_FOR_RESET;
                LEDManager::getManager()->setLEDColors((uint8_t)this->ledColorCharacteristic->getData()[1]);

                auto reactionTime = millis() - this->peripheralTimer;
                Serial.printf("Reaction time: %lu ms\n", reactionTime);
                this->notifyCharacteristic->setValue(std::to_string(reactionTime));
                this->notifyCharacteristic->notify();
            }
            break;
        }
        case BLEPeripheralState::WAIT_FOR_RESET:
            if(this->actionModeCharacteristic->getData()[0] == 'o') {
                Serial.println("resetting...");
                this->actionModeCharacteristic->setValue("");
                this->notifyCharacteristic->setValue("");
                this->peripheralState = BLEPeripheralState::READY;
            }
            break;
    }
}

bool BLEManager::runModelSelector() {

    auto buttonPressed = digitalRead(PIN_BUTTON_PRESS) == LOW;
    if(buttonPressed) {
        if(this->modelSelectorCounter == 0) {
            this->modelSelectorPressStart = millis();
            this->modelSelectorCounter++;  
        } else {
            //check if the button has been pressed for more than 2 seconds
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
                    //model selected. Run corresponding block configuration

                    switch(this->selectedModel) {
                        case 0:
                            Serial.println("Model selected: Reaction Buzzer");
                            initReactionMode();
                            break;
                        case 1:
                            Serial.println("Model selected: Decider");
                            initStarMode(3, 255);
                            break;
                        case 2:
                            Serial.println("Model selected: Random Triangle");
                            initRandomMode(3, 12);
                            break;
                        case 3:
                            Serial.println("Model selected: Square Config");
                            initRandomMode(4, 12);
                            break;
                        case 4:
                            Serial.println("Model selected: Star Config");
                            initStarMode(5, 12);
                            break;
                        case 5:
                            Serial.println("Model selected: Star Config");
                            initStarMode(4, 18);
                            break;
                        default:
                            Serial.println("Model selected: Default");
                            initReactionMode();
                            break;
                    }
                    return true;
                }
            }

        }
    } else {
        //trigger on release
        if(this->modelSelectorCounter > 0 && this->modelSelectorCounter <= 100) {
            //long press detected
            this->selectedModel = (this->selectedModel + 1) % 6; //only one model for now
            
            LEDManager::getManager()->turnOff();
            
            switch(this->selectedModel) {
                case 0:
                    LEDManager::getManager()->setLEDColors(9, BLUE);
                    break;
                case 1:
                    LEDManager::getManager()->setLEDColors(7, BLUE);
                    LEDManager::getManager()->setLEDColors(9, YELLOW);
                    LEDManager::getManager()->setLEDColors(11, BLUE);
                    break;
                case 2:
                    LEDManager::getManager()->setLEDColors(7, BLUE);
                    LEDManager::getManager()->setLEDColors(9, BLUE);
                    LEDManager::getManager()->setLEDColors(11, BLUE);
                    break;
                case 3:
                    LEDManager::getManager()->setLEDColors(6, BLUE);
                    LEDManager::getManager()->setLEDColors(8, BLUE);
                    LEDManager::getManager()->setLEDColors(10, BLUE);
                    LEDManager::getManager()->setLEDColors(12, BLUE);
                    break;
                case 4:
                    LEDManager::getManager()->setLEDColors(5, BLUE);
                    LEDManager::getManager()->setLEDColors(7, BLUE);
                    LEDManager::getManager()->setLEDColors(9, YELLOW);
                    LEDManager::getManager()->setLEDColors(11, BLUE);
                    LEDManager::getManager()->setLEDColors(13, BLUE);
                    break;
                case 5:
                    LEDManager::getManager()->setLEDColors(6, YELLOW);
                    LEDManager::getManager()->setLEDColors(8, BLUE);
                    LEDManager::getManager()->setLEDColors(10, BLUE);
                    LEDManager::getManager()->setLEDColors(12, BLUE);
                    break;
                default:
                    break;
            }

        }


        this->modelSelectorCounter = 0;
        this->modelSelectorPressStart = 0;
    }


    return false;
}

void BLEManager::startConfigurationBLE() {
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

    Serial.println("BLE Server advertising...");
    if(this->peripheralState == BLEPeripheralState::WAITING_FOR_CONNECTION) {
        this->startServer();
    } else {
        Serial.println("Already in Peripheral mode");
    }
}


void BLEManager::runAsCentral() {
    // In Central mode, we will scan for peripherals and connect to them
    
    //The central state machine has the following modes:
    // 1. Waiting for the model to be selected
    // 2. Waiting for the required number of peripherals to be connected
    // 3. Confirm
    // 4. Run the block manager 

    switch(this->centralState) {
        case BLECentralState::WAITING_FOR_MODEL_SELECTION:
        {
            // In this state, the central is waiting for the model to be selected
            // Here you can implement logic to select a model


            bool modelSelected = runModelSelector(); // Placeholder for model selection logic

            if(modelSelected) {
                this->centralState = BLECentralState::WAITING_FOR_PERIPHERALS;
                this->requiredPeripherals = VariableManager::getManager()->getVariable("REQUIRED_PERIPHERALS"); // Set the required number of peripherals to connect
                this->connectedPeripherals = 0; // Reset the count of connected peripherals
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
            // In this state, the central confirms the connection with the peripherals
            if(this->connectedPeripherals == this->requiredPeripherals && digitalRead(PIN_BUTTON_PRESS) == LOW) {                    
                Serial.println("Confirmed connection with peripherals");

                    this->centralState = BLECentralState::RUN_BLOCK_MANAGER;
                    LEDManager::getManager()->turnOff(); // Turn off LEDs after confirmation
                }

            //check the max loop parameter 
            
            std::string value = this->maxLoopCharacteristic->getValue();
            auto setValue = std::stoll(value);
            if(setValue > 0) {
                VariableManager::getManager()->setVariable("MAX_LOOPS", setValue);
            }
            break;
        }
        case BLECentralState::RUN_BLOCK_MANAGER:
        {
            //check if all peripherals are still connected
            for(uint8_t i = 0; i < this->connectedPeripherals; i++) {
                if(!this->peripherals[i]->isConnected()) {
                    this->centralState = BLECentralState::ERROR;
                    break;
                }
            }

            // In this state, the central runs the block manager
            // Here you can implement logic to run the block manager
            BlockManager::getManager()->runBlocks();
            

            break;
        }
        case BLECentralState::ERROR:
        {
            LEDManager::getManager()->setLEDColors(errorPattern);
            // Handle error state
            Serial.println("An error occurred in Central mode");
            break;
        }
    }
}

Peripheral* BLEManager::getPeripheral(uint8_t peripheralId) {
    if (peripheralId < 32) {
        return this->peripherals[peripheralId];
    }
    return nullptr; // Return nullptr if the peripheralId is out of bounds
}

void BLEManager::bootMode(BLEMode mode) {
    
    switch (mode) {
        case BLEMode::CENTRAL:
            Serial.println("Booting in Central mode");
            this->startClient();
            break;
        case BLEMode::PERIPHERAL:
            Serial.println("Booting in Peripheral mode");
            this->startServer();
            break;
        default:
            Serial.println("Unknown BLE mode");
            break;
    }
}

// --- Server (Peripheral) Implementation ---
void BLEManager::startServer() {
    BLEDevice::init("ReactPod");
    this->peripheralState = BLEPeripheralState::WAITING_FOR_CONNECTION;

    BLEServer *pServer = BLEDevice::createServer();
    BLEService *pService = pServer->createService(SERVICE_UUID);

    // Team ID characteristic (writable by client)
    this->teamIdCharacteristic = pService->createCharacteristic(
        CHAR_TEAM_ID_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );

    this->teamIdCharacteristic->setValue(""); // Set a default value

    // LED Color characteristic (writable by client)
    this->ledColorCharacteristic = pService->createCharacteristic(
        CHAR_LED_COLOR_UUID, BLECharacteristic::PROPERTY_WRITE
    );

    // Action Mode characteristic (writable by client)
    this->actionModeCharacteristic= pService->createCharacteristic(
        CHAR_ACTION_MODE_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );

    // Notify characteristic (notifies client on change)
    this->notifyCharacteristic = pService->createCharacteristic(
        CHAR_NOTIFY_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
    );
    this->notifyCharacteristic->addDescriptor(new BLE2902());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("BLE Server advertising...");
}

// --- Client (Central) Implementation ---
void BLEManager::startClient() {
    //placeholder for now
    this->centralState = BLECentralState::WAITING_FOR_MODEL_SELECTION;
    this->startConfigurationBLE();
}

void BLEManager::clientScanForPeripherals() {
    BLEScan* pBLEScan = BLEDevice::getScan();
    Serial.println("Starting BLE scan...");
    pBLEScan->setActiveScan(true);
    BLEScanResults foundDevices = pBLEScan->start(2, false);
    Serial.println("Scan complete, found devices: ");

    for (int i = 0; i < foundDevices.getCount(); i++) {
        
        BLEAdvertisedDevice advertisedDevice = foundDevices.getDevice(i);

        if (advertisedDevice.haveServiceUUID() && advertisedDevice.isAdvertisingService(BLEUUID(SERVICE_UUID))) {
            Serial.printf("Found device: %s\n", advertisedDevice.toString().c_str());
            Serial.printf("Address: %s\n", advertisedDevice.getAddress().toString().c_str());

            // Create a Peripheral instance for the found device
            Peripheral* peripheral = new Peripheral(advertisedDevice, this->connectedPeripherals);
            this->peripherals[this->connectedPeripherals] = peripheral;
            // Increment the count of connected peripherals
            this->connectedPeripherals++;
        }

        if(this->connectedPeripherals == this->requiredPeripherals) {
                break;
            }
    }
}

void BLEManager::subscribeNotify(BLERemoteCharacteristic* pChar , Peripheral* peripheral) {
    BLEManager::notifyMap[pChar] = peripheral;
    pChar->registerForNotify(BLEManager::notifyCallback);
    Serial.println("Subscribed to notifications for characteristic: ");
}

void BLEManager::notifyCallback(
    BLERemoteCharacteristic* pChar,
    uint8_t* pData, size_t length, bool isNotify
) {
    auto it = BLEManager::notifyMap.find(pChar);
    if (it != BLEManager::notifyMap.end()) {
        it->second->handleNotify(pChar, pData, length, isNotify);
    }
}

void BLEManager::handleNotify(Peripheral* peripheral) {
    Serial.println("Handling notification from peripheral"); 
    this->peripheralQueue.push(peripheral);
    
}

