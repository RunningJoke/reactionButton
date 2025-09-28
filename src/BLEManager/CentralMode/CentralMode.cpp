#include "CentralMode.h"

std::map<BLERemoteCharacteristic*, Peripheral*> CentralMode::notifyMap;

// --- Server (Peripheral) Implementation ---
CentralMode::CentralMode() {//placeholder for now
    this->centralState = BLECentralState::WAITING_FOR_MODEL_SELECTION;
    this->startConfigurationBLE();
    
    this->modelSelectorColor = new ColorSet{0,0,0};
}

void CentralMode::runMode() {
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



void CentralMode::clientScanForPeripherals() {
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
            Peripheral* peripheral = new Peripheral(advertisedDevice, this->connectedPeripherals, this);
            
            this->peripherals[this->connectedPeripherals] = peripheral;
            // Increment the count of connected peripherals
            this->connectedPeripherals++;
        }

        if(this->connectedPeripherals == this->requiredPeripherals) {
                break;
            }
    }
}


bool CentralMode::runModelSelector() {

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

Peripheral* CentralMode::getPeripheral(uint8_t peripheralId) {
    if (peripheralId < 32) {
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
    Serial.println("Subscribed to notifications for characteristic: ");
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

void CentralMode::handleNotify(Peripheral* peripheral) {
    Serial.println("Handling notification from peripheral"); 
    this->peripheralQueue.push(peripheral);
}
