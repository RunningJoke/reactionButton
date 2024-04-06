#pragma once

#include <WebServer.h>
#include <SPIFFS.h>

class ParentPodWebServerHandlers
{
    protected:
        static WebServer* server;
    public:

        static void registerWebServer(WebServer* server);

        static void serverGetHomepage();
};