#include "Peripheral.h"
#include "BLEManager/BLEManager.h"

Peripheral::Peripheral(BLEAdvertisedDevice advertisedDevice, uint8_t peripheralId)
{
    // Initialize the peripheral with the advertised device and ID
    // This could include setting up characteristics, services, etc.
    // For now, we will just store the advertised device and ID
    this->advertisedDevice = advertisedDevice;
    this->peripheralId = peripheralId;

    //register the peripheral
    this->pClient = BLEDevice::createClient();

    if (this->pClient->connect(&advertisedDevice)) {

        this->remoteService = this->pClient->getService(SERVICE_UUID);
        
        this->teamIdCharacteristic = this->remoteService->getCharacteristic(CHAR_TEAM_ID_UUID);
        if (this->remoteService) {
            // Write unique team ID
            if (this->teamIdCharacteristic && this->teamIdCharacteristic->canWrite()) {
                std::string teamId = "TEAM123";
                this->teamIdCharacteristic->writeValue(teamId);
            }

            this->ledColorCharacteristic = this->remoteService->getCharacteristic(CHAR_LED_COLOR_UUID);
            this->actionModeCharacteristic = this->remoteService->getCharacteristic(CHAR_ACTION_MODE_UUID);
            this->notifyCharacteristic = this->remoteService->getCharacteristic(CHAR_NOTIFY_UUID);

            BLEManager::getManager()->subscribeNotify(this->notifyCharacteristic , this);
        }
    } 

}

bool Peripheral::isConnected() {
    return this->pClient->isConnected();
}

void Peripheral::resetPeripheral() {
    Serial.println("Peripheral reset");
    this->actionModeCharacteristic->writeValue('o'); // Reset action mode
}

void Peripheral::activate()
{
    // Activate the peripheral, which could mean setting up characteristics or starting notifications
    // This is a placeholder for now
    uint8_t ledColor[3] = {1, 255, 255}; // Example: Blue color

    this->ledColorCharacteristic->writeValue(ledColor , 3 , false); // Example: Set initial LED color
    this->actionModeCharacteristic->writeValue('1', false);
}

// Set the LED color characteristic value
void Peripheral::setLedColor(const std::string& color)
{

}

// Set the action mode characteristic value
void Peripheral::setActionMode(const std::string& mode)
{

}

void Peripheral::handleNotify(
    BLERemoteCharacteristic* pChar,
    uint8_t* pData, size_t length, bool isNotify
) {
    Serial.println("Notification received from characteristic: ");
    // Handle notifications from the peripheral
    this->peripheralTimer = atoi((char*)pData);
    // Process the notification data as needed
    // This could include updating the LED color or action mode based on the notification
    BLEManager::getManager()->handleNotify(this);
}