#pragma once

#include "../VPod.h"
#include <WiFi.h>
#include <esp_now.h>
#include <WebServer.h>
#include <BLEAdvertising.h>
#include <BLEScan.h>
#include "LEDManager/LEDManager.h"

class ParentPod : public VPod {
    public:
        ParentPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;

        void registerChild(BLEAdvertisedDevice* device);
        
    protected:
        const char* PARENT_POD_WIFI_SSID = "ReactionPod network";  // Enter SSID here
        const char* PARENT_POD_WIFI_PASSWORD = "Alli-Go!";  //Enter Password here

        /* Put IP Address details */
        const IPAddress* PARENT_POD_IP = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_GATEWAY = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_SUBNET = new IPAddress(255,255,255,0);

        WebServer* parentServer;

        BLEClient* pBLEClient;

    private:
        LEDManager* ledManager; 
        void configureWebServer();
};


class ParentPodAdvertisedDeviceCallbacks: public BLEAdvertisedDeviceCallbacks {
    public:
        ParentPod* linkedParentPod;

    
    void onResult(BLEAdvertisedDevice advertisedDevice) {
      // We have found a device, let us now see if it contains the service we are looking for.
      if (advertisedDevice.haveServiceUUID() && advertisedDevice.isAdvertisingService(BLEUUID(BLE_REACTION_POD_ID))) {
        BLEAddress serverAddress = advertisedDevice.getAddress();

        this->linkedParentPod->registerChild(&advertisedDevice);

      }
    }
};


#include "ParentPodWebServerHandlers.h"