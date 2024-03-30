#include "ParentPod.h"


ParentPod::ParentPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
}

int8_t ParentPod::update(uint64_t timestamp)
{
    //this->parentServer->handleClient();
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
    //now start broadcasting the esp now master signal
    

}

void ParentPod::stop()
{
    delete this->parentServer;
}


void ParentPod::configureWebServer()
{
    ParentPodWebServerHandlers::registerWebServer(this->parentServer);
    ParentPodWebServerHandlers::registerParentPod(this);
    this->parentServer->on("/",HTTPMethod::HTTP_GET, ParentPodWebServerHandlers::serverGetHomepage);
}

void ParentPod::handleData(const uint8_t *mac_addr, const uint8_t *data, int data_len)
{
    Serial.print("Data received: " );
    Serial.println((char*)data);
    if(data_len == 6 && strcasecmp((char*)data, "MARCO") == 0) {
            Serial.println("Someone is looking for a polo");
            
            const uint8_t data[] = "POLO";
            esp_now_send(mac_addr , data , 5);
        }
}


