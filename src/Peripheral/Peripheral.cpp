#include "Peripheral.h"
#include "BLEManager/BLEManager.h"

Peripheral::Peripheral(BLEAdvertisedDevice advertisedDevice, uint8_t peripheralId, IBuzzerMode* mode)
{
    this->advertisedDevice = advertisedDevice;
    this->peripheralId = peripheralId;
    this->mode = mode;

    //register the peripheral
    this->pClient = BLEDevice::createClient();

    if (!this->pClient->connect(&advertisedDevice)) {
        Serial.println("Peripheral: connect failed");
        return;
    }

    this->remoteService = this->pClient->getService(SERVICE_UUID);
    if (this->remoteService == nullptr) {
        Serial.println("Peripheral: service not found");
        return;
    }

    this->teamIdCharacteristic = this->remoteService->getCharacteristic(CHAR_TEAM_ID_UUID);
    this->ledColorCharacteristic = this->remoteService->getCharacteristic(CHAR_LED_COLOR_UUID);
    this->actionModeCharacteristic = this->remoteService->getCharacteristic(CHAR_ACTION_MODE_UUID);
    this->notifyCharacteristic = this->remoteService->getCharacteristic(CHAR_NOTIFY_UUID);
    this->resetCharacteristic = this->remoteService->getCharacteristic(CHAR_RESET_UUID);

    if (!this->isValid()) {
        Serial.println("Peripheral: characteristics missing, not a ReactPod peripheral");
        return;
    }

    // Write unique team ID
    if (this->teamIdCharacteristic->canWrite()) {
        std::string teamId = "TEAM123";
        this->teamIdCharacteristic->writeValue(teamId);
    }

    this->mode->subscribeNotify(this->notifyCharacteristic , this);
}

bool Peripheral::isValid() {
    return this->pClient != nullptr && this->pClient->isConnected()
        && this->teamIdCharacteristic != nullptr
        && this->ledColorCharacteristic != nullptr
        && this->actionModeCharacteristic != nullptr
        && this->notifyCharacteristic != nullptr
        && this->resetCharacteristic != nullptr;
}

bool Peripheral::isConnected() {
    return this->pClient->isConnected();
}

void Peripheral::disconnect() {
    if (this->pClient != nullptr && this->pClient->isConnected()) {
        this->pClient->disconnect();
    }
}

void Peripheral::resetPeripheral() {
    this->resetCharacteristic->writeValue('1', false);
}

void Peripheral::activate()
{
    this->setActionMode(PeripheralActionMode::HIT);
}

PeripheralActionMode Peripheral::getActionMode() {
    return this->actionMode;
}

void Peripheral::arm(PeripheralActionMode mode, uint8_t colorActive, uint8_t colorAfter)
{
    this->actionMode = mode;
    uint8_t ledColor[3] = {colorActive, colorAfter, 255};
    // colour first, the action mode write starts the peripheral's timer
    this->ledColorCharacteristic->writeValue(ledColor, 3, false);
    this->actionModeCharacteristic->writeValue((uint8_t)mode, false);
}

// Set the action mode characteristic value
void Peripheral::setActionMode(PeripheralActionMode mode)
{
    switch (mode)
    {
        case PeripheralActionMode::AVOID:
            this->arm(mode, RemoteColor::RED, RemoteColor::OFF);
            break;
        case PeripheralActionMode::COUNTER:
        case PeripheralActionMode::COUNTDOWN:
            this->actionMode = mode;
            this->actionModeCharacteristic->writeValue((uint8_t)mode, false);
            break;
        case PeripheralActionMode::HIT:
        default:
            this->arm(PeripheralActionMode::HIT, RemoteColor::GREEN, RemoteColor::OFF);
            break;
    }
}

void Peripheral::handleNotify(
    BLERemoteCharacteristic* pChar,
    uint8_t* pData, size_t length, bool isNotify
) {
    // payload is an ASCII number without terminator
    char buffer[16];
    size_t n = length < sizeof(buffer) - 1 ? length : sizeof(buffer) - 1;
    memcpy(buffer, pData, n);
    buffer[n] = '\0';

    this->lastResult = (int32_t)strtol(buffer, nullptr, 10);
    this->mode->handleNotify(this);
}
