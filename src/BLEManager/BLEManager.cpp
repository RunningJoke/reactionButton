#include "BLEManager.h"

BLEManager* BLEManager::manager = nullptr;

std::map<BLERemoteCharacteristic*, BLEManager*> BLEManager::notifyMap;

BLEManager* BLEManager::getManager() {

    if(BLEManager::manager == nullptr) {        
        BLEManager::manager = new BLEManager();
    }

    return BLEManager::manager;
};

BLEManager::BLEManager() {
    BLEDevice::init("ReactPod");
}

void BLEManager::runAsPeripheral() {

    switch(this->peripheralState) {
        case BLEPeripheralState::WAITING_FOR_CONNECTION:
            // In this state, the peripheral is waiting for a client to connect
            if(this->teamIdCharacteristic->getValue().length() > 0) {
                // If the team ID is set, we can transition to READY state
                this->peripheralState = BLEPeripheralState::CONNECTED;
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
            LEDManager::getManager()->setLEDColors(this->ledColorCharacteristic->getData()[0]);
            if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                Serial.println("Peripheral button hit");
                // If the button is pressed, we can transition to ACTIVE state
                this->peripheralState = BLEPeripheralState::WAIT_FOR_RESET;
                LEDManager::getManager()->setLEDColors(this->ledColorCharacteristic->getData()[1]);

                auto reactionTime = millis() - this->peripheralTimer;
                Serial.printf("Reaction time: %lu ms\n", reactionTime);
                this->notifyCharacteristic->setValue(std::to_string(reactionTime));
                this->notifyCharacteristic->notify();
            }
            // Depending on given 
            break;
        }
        case BLEPeripheralState::WAIT_FOR_RESET:
            if(this->actionModeCharacteristic->getData()[0] == 'o') {
                Serial.println("Peripheral reset");
                this->actionModeCharacteristic->setValue("");
                this->notifyCharacteristic->setValue("");
                this->peripheralState = BLEPeripheralState::READY;
            }
            break;
    }
}


void BLEManager::runAsCentral() {
    // In Central mode, we will scan for peripherals and connect to them
    

    if(this->connectedPeripherals == this->requiredPeripherals) {
        switch(this->waitingForPeripheral) {
            case 0: //activate peripheral
                {
                    BLERemoteCharacteristic* configArrayCharacteristic = this->remoteService[0]->getCharacteristic(CHAR_LED_COLOR_UUID);
                    BLERemoteCharacteristic* actionCharacteristic = this->remoteService[0]->getCharacteristic(CHAR_ACTION_MODE_UUID);

                    uint8_t ledColor[3] = {2, 1, 255}; // Example: Blue color

                    configArrayCharacteristic->writeValue(ledColor , false); // Example: Set initial LED color
                    actionCharacteristic->writeValue('1', false);
                    this->centralTimer = millis();
                    this->waitingForPeripheral = 1;
                break;
                }
            case 1: //waiting for peripheral                
                break;
            case 2: //peripheral was activated, reset
                {
                this->waitingForPeripheral = 0;
                BLERemoteCharacteristic* actionCharacteristic = this->remoteService[0]->getCharacteristic(CHAR_ACTION_MODE_UUID);

                // If we have received a notification, we can process it
                Serial.printf("Received notification: %d\n", this->peripheralTimer);
                Serial.printf("Response time: %d\n", this->centralTimer);
                this->waitingForPeripheral = false;
                actionCharacteristic->writeValue("o"); // Example action to reset peripheral
                delay(3000UL);
                break;
                }
        }

    } else {
        this->clientScanForPeripherals();
    }
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

}

void BLEManager::clientScanForPeripherals() {
    BLEScan* pBLEScan = BLEDevice::getScan();
    Serial.println("Starting BLE scan...");
    pBLEScan->setActiveScan(true);
    BLEScanResults foundDevices = pBLEScan->start(5, false);
    Serial.println("Scan complete, found devices: ");

    for (int i = 0; i < foundDevices.getCount(); i++) {
        
        BLEAdvertisedDevice advertisedDevice = foundDevices.getDevice(i);

        if (advertisedDevice.haveServiceUUID() && advertisedDevice.isAdvertisingService(BLEUUID(SERVICE_UUID))) {
            BLEClient* pClient = BLEDevice::createClient();
            if (pClient->connect(&advertisedDevice)) {
                this->remoteService[this->connectedPeripherals] = pClient->getService(SERVICE_UUID);
                if (this->remoteService[this->connectedPeripherals]) {
                    // Write unique team ID
                    BLERemoteCharacteristic* teamIdChar = this->remoteService[this->connectedPeripherals]->getCharacteristic(CHAR_TEAM_ID_UUID);
                    if (teamIdChar && teamIdChar->canWrite()) {
                        std::string teamId = "TEAM123";
                        teamIdChar->writeValue(teamId);
                    }
                    BLERemoteCharacteristic* notifyChar = this->remoteService[this->connectedPeripherals]->getCharacteristic(CHAR_NOTIFY_UUID);
                    this->subscribeNotify(notifyChar);
                    this->connectedPeripherals++;
                }
            }            
        }

        if(this->connectedPeripherals == this->requiredPeripherals) {
                break;
            }
    }
}

void BLEManager::subscribeNotify(BLERemoteCharacteristic* pChar) {
    BLEManager::notifyMap[pChar] = this;
    pChar->registerForNotify(BLEManager::notifyCallback);
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

void BLEManager::handleNotify(
    BLERemoteCharacteristic* pChar,
    uint8_t* pData, size_t length, bool isNotify
) {
    this->centralTimer = millis() - this->centralTimer;
    this->peripheralTimer = atoi((char*)pData);
    this->waitingForPeripheral = 2; // Set the state to indicate that we received a notification
}

