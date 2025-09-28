#include "ServerMode.h"


// --- Server (Peripheral) Implementation ---
ServerMode::ServerMode() {
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

    this->resetCharacteristic = pService->createCharacteristic(
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

void ServerMode::runMode() {

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
