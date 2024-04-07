#include "ParentPod.h"


ParentPod::ParentPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
    this->currentStatus = 0;
    NodeManager::ledManager = ledManager;
    NodeManager::registerManagingNode();
}


int8_t ParentPod::update(uint64_t timestamp)
{
    this->parentServer->handleClient();

    //monitor own button status
    if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
        NodeManager::getNode(0)->pressed(timestamp);
    }

    switch(this->currentStatus)
    {
        case 0: //config mode, register new children and wait
        {

            if(timestamp % 5000 == 0) {
                //run a scan
                Serial.println("Run scan");
                this->runScan();
            }

            if(this->pScanCallback->pendingRegistration != nullptr) {
                NodeManager::registerNode(*this->pScanCallback->pendingRegistration);
                this->pScanCallback->pendingRegistration = nullptr;
            }

            if(digitalRead(PIN_BUTTON_PRESS) == LOW) {
                //button pressed, switch to actual active mode
                this->currentStatus = 1;
            }
            break;
        }
        case 1:
        {
            //select the program to run
            switch(NodeManager::getNodeCount()) {
                case 1:
                    this->activeMode = new ReactionMode(this->ledManager);
                    this->currentStatus = 2;
                    break;
                case 2:
                    this->activeMode = new AlternatingMode(this->ledManager, 10);
                    this->currentStatus = 2;
                    break;
                case 5:
                    this->activeMode = new StarMode(this->ledManager, NodeManager::getNodeCount(), 12);
                    break;
                default:
                    this->activeMode = new RandomMode(this->ledManager, NodeManager::getNodeCount() , 12);
                    this->currentStatus = 2;
                    break;
            }
            break;
        }
        case 2:
            this->activeMode->run(timestamp);
            break;
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
    Serial.println("Register callback");
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


