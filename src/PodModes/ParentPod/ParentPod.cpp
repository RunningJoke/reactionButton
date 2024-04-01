#include "ParentPod.h"


ParentPod::ParentPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
}

bool ParentPod::acknowledgePod(BLEClient* client, BLEAddress* newPod)
{
        //create a new client for the connection
        
        if(client->connect(*newPod) == false) {
            Serial.println("Failed to connect");
            return false;
        } else {
            Serial.println("Connection successful");
        }


        BLERemoteService* pRemoteService = client->getService(BLEUUID(BLE_REACTION_POD_ID));
        if (pRemoteService == nullptr) {
            Serial.print("Failed to find our service UUID");
            return false;
        }

        BLERemoteCharacteristic* modeCharacteristic = pRemoteService->getCharacteristic(BLE_MODE_UID);

        if(modeCharacteristic == nullptr) {
            Serial.print("Failed to find mode characteristic");        
            return false;
        }
        Serial.println("Writing characteristic");
        modeCharacteristic->writeValue('1');

        BLERemoteCharacteristic* stopWatchCharacteristic = pRemoteService->getCharacteristic(BLE_REACTION_TIME_UID);
        if(stopWatchCharacteristic == nullptr) {
            Serial.print("Failed to find stopwatch characteristic");        
            return false;
        }

        stopWatchCharacteristic->registerForNotify(ParentPod::notifyCallback);

        return true;
        
}

void ParentPod::notifyCallback(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify)
{
    Serial.println("NOTIFY RECEIVED");
    Serial.println((char*)pData);
}

int8_t ParentPod::update(uint64_t timestamp)
{
    this->parentServer->handleClient();

    for(uint8_t i = 0; i < this->linkedChildrenCount ; i++) {

        if(this->linkedChildrenStatus[i] == PodStatus::ADDED) {
            this->linkedChildrenClients[i] = BLEDevice::createClient();
            if(this->acknowledgePod(this->linkedChildrenClients[i], this->linkedChildren[i]) == true) {
                Serial.println("Pod acknowledged");
                this->linkedChildrenStatus[i] = PodStatus::ACKNOWLEDGED;
            }
        } 
    }

    if(timestamp % 5000 == 0) {
        //run a scan
        Serial.println("Run scan");
        this->runScan();
    }
    
    return 0;
}

void ParentPod::runScan()
{
    //this is a blocking method!
    pBLEScan->start(1, true);    
}

void ParentPod::start()
{
    this->ledManager->setLEDColors(this->ledManager->MAGENTA);
    this->parentServer = new WebServer(80);

    WiFi.mode(WIFI_AP);
    WiFi.softAP(this->PARENT_POD_WIFI_SSID, this->PARENT_POD_WIFI_PASSWORD);
    WiFi.softAPConfig(*this->PARENT_POD_IP, *this->PARENT_POD_GATEWAY, *this->PARENT_POD_SUBNET);
    
    //wait for configuration to apply
    delay(100);

    this->configureWebServer();

    this->parentServer->begin();


    BLEDevice::init("Parent Reaction Pod");
    this->pBLEClient = BLEDevice::createClient();
    this->pBLEScan = BLEDevice::getScan();

    this->pScanCallback = new ParentPodAdvertisedDeviceCallbacks(this, pBLEScan);

    pBLEScan->setAdvertisedDeviceCallbacks(this->pScanCallback);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(449);
    pBLEScan->setActiveScan(true);

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
    //Stop blocking advertising
    this->pBLEScan->stop();
    Serial.println("Running Child registration");    

    this->linkedChildren[this->linkedChildrenCount]  = new BLEAddress(device->getAddress());
    this->linkedChildrenStatus[this->linkedChildrenCount]  = PodStatus::ADDED;

    Serial.print("Added ");
    Serial.print(this->linkedChildren[this->linkedChildrenCount]->toString().c_str());
    Serial.println(" as child");

    

    this->linkedChildrenCount++;

    

}


