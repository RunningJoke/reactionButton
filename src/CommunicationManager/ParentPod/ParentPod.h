#pragma once

#include "../VPod.h"
#include <WiFi.h>
#include <esp_now.h>
#include <WebServer.h>
#include "LEDManager/LEDManager.h"

class ParentPod : public VPod {
    public:
        ParentPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;

        void handleData(const uint8_t *mac_addr, const uint8_t *data, int data_len);

    protected:
        const char* PARENT_POD_WIFI_SSID = "ReactionPod network";  // Enter SSID here
        const char* PARENT_POD_WIFI_PASSWORD = "Alli-Go!";  //Enter Password here

        /* Put IP Address details */
        const IPAddress* PARENT_POD_IP = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_GATEWAY = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_SUBNET = new IPAddress(255,255,255,0);

        WebServer* parentServer;

    private:
        LEDManager* ledManager; 
        void configureWebServer();
};


#include "ParentPodWebServerHandlers.h"