#include "ParentPodWebServerHandlers.h"

WebServer* ParentPodWebServerHandlers::server = nullptr;

void ParentPodWebServerHandlers::registerWebServer(WebServer* server)
{
    ParentPodWebServerHandlers::server = server;
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

