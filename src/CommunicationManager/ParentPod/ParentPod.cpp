#include "ParentPod.h"


ParentPod::ParentPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
}

int8_t ParentPod::update(uint64_t timestamp)
{
    this->parentServer->handleClient();


    //

    
    return 0;
}

void ParentPod::start()
{
    this->ledManager->setLEDColors(this->ledManager->MAGENTA);
    this->parentServer = new WebServer(80);

    WiFi.softAP(this->PARENT_POD_WIFI_SSID, this->PARENT_POD_WIFI_PASSWORD);
    WiFi.softAPConfig(*this->PARENT_POD_IP, *this->PARENT_POD_GATEWAY, *this->PARENT_POD_SUBNET);
    
    //wait for configuration to apply
    delay(100);

    this->configureWebServer();

    this->parentServer->begin();


    BLEDevice::init("Parent Reaction Pod");
    this->pBLEClient = BLEDevice::createClient();

    BLEScan* pBLEScan = BLEDevice::getScan();

    ParentPodAdvertisedDeviceCallbacks* advCB = new ParentPodAdvertisedDeviceCallbacks();
    advCB->linkedParentPod = this;

    pBLEScan->setAdvertisedDeviceCallbacks(advCB);
    pBLEScan->setInterval(1349);
    pBLEScan->setWindow(449);
    pBLEScan->setActiveScan(true);
    pBLEScan->start(600);


    

}

void ParentPod::stop()
{
    delete this->parentServer;
}


void ParentPod::configureWebServer()
{
    ParentPodWebServerHandlers::registerWebServer(this->parentServer);
    this->parentServer->on("/",HTTPMethod::HTTP_GET, ParentPodWebServerHandlers::serverGetHomepage);
}


void ParentPod::registerChild(BLEAdvertisedDevice* device)
{
    Serial.println("Running Child registration");

    auto adress = device->getAddress().toString();

    Serial.println(adress.c_str());
    Serial.println(device->getName().c_str());
    if(this->pBLEClient->connect(device->getAddress()) == false) {
        Serial.println("Failed to connect");
        return;
    } else {
        Serial.println("Connection successful");
    }

    BLERemoteService* pRemoteService = this->pBLEClient->getService(BLEUUID(BLE_REACTION_POD_ID));
    if (pRemoteService == nullptr) {
        Serial.print("Failed to find our service UUID");
        return;
    }

    BLERemoteCharacteristic* modeCharacteristic = pRemoteService->getCharacteristic(BLE_MODE_UID);

    if(modeCharacteristic == nullptr) {
        Serial.print("Failed to find mode characteristic");        
        return;
    }
    Serial.println("Writing characteristic");
    modeCharacteristic->writeValue('1');

}


