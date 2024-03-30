#pragma once

#include <WebServer.h>
#include <SPIFFS.h>
#include "ParentPod.h"

class ParentPodWebServerHandlers
{
    protected:
        static WebServer* server;
        static ParentPod* parentPod;
    public:

        static void registerWebServer(WebServer* server);
        static void registerParentPod(ParentPod* parentPod);

        static void receive(const uint8_t *mac_addr, const uint8_t *data, int data_len);

        static void serverGetHomepage();
};