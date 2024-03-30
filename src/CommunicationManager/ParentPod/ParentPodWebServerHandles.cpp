#include "ParentPodWebServerHandlers.h"

WebServer* ParentPodWebServerHandlers::server = nullptr;
ParentPod* ParentPodWebServerHandlers::parentPod = nullptr;

void ParentPodWebServerHandlers::registerWebServer(WebServer* server)
{
    ParentPodWebServerHandlers::server = server;
}

void ParentPodWebServerHandlers::registerParentPod(ParentPod* parentPod)
{
    ParentPodWebServerHandlers::parentPod = parentPod;
}

void ParentPodWebServerHandlers::serverGetHomepage()
{
    File homepage = SPIFFS.open("/homepage.html", "r");
    Serial.println(homepage);
    if(homepage) {
        String str = homepage.readString();
        ParentPodWebServerHandlers::server->send(200, "text/html" , str);
        homepage.close();
    }

}

void ParentPodWebServerHandlers::receive(const uint8_t *mac_addr, const uint8_t *data, int data_len)
{
    ParentPodWebServerHandlers::parentPod->handleData(mac_addr, data, data_len);
}
