#include "BLEManager/BLEManager.h"
#include "Peripheral/Peripheral.h"

BLEManager* BLEManager::manager = nullptr;

std::map<BLERemoteCharacteristic*, Peripheral*> BLEManager::notifyMap;

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
                Serial.println("resetting...");
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
                    
                    this->peripherals[0]->activate();
                    
                    this->centralTimer = millis();
                    this->waitingForPeripheral = 1;
                break;
                }
            case 1: //waiting for peripheral                
                break;
            case 2: //peripheral was activated, reset
                {
                this->waitingForPeripheral = 0;
                Serial.println("Resetting peripheral");
                this->peripherals[0]->resetPeripheral();
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
    //this->centralTimer = millis() - this->centralTimer;    
    this->waitingForPeripheral = 2; // Set the state to indicate that we received a notification

    
}

