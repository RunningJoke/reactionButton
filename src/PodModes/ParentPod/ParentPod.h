#pragma once

#include "../VPod.h"
#include <WiFi.h>
#include <esp_now.h>
#include <WebServer.h>
#include <BLEAdvertising.h>
#include <BLEScan.h>
#include "LEDManager/LEDManager.h"
#include "NodeManager/NodeManager.h"
#include "Modes/ReactionMode/ReactionMode.h"
#include "Modes/AlternatingMode/AlternatingMode.h"

class ParentPodAdvertisedDeviceCallbacks;

enum class PodStatus : uint8_t { EMPTY , ADDED , ACKNOWLEDGED  };
class ParentPod : public VPod {
    public:
        ParentPod(LEDManager* ledManager);
        int8_t update(uint64_t timestamp) override;
        void start() override;
        void stop() override;

        void registerChild(BLEAdvertisedDevice* device);

        static void notifyCallback(BLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
        
    protected:
        const char* PARENT_POD_WIFI_SSID = "ReactionPod network";  // Enter SSID here
        const char* PARENT_POD_WIFI_PASSWORD = "Alli-Go!";  //Enter Password here

        /* Put IP Address details */
        const IPAddress* PARENT_POD_IP = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_GATEWAY = new IPAddress(192,168,1,1);
        const IPAddress* PARENT_POD_SUBNET = new IPAddress(255,255,255,0);

        WebServer* parentServer;
        BLEClient* pBLEClient;
        BLEScan* pBLEScan;
        BLEAddress* linkedChildren[10];
        PodStatus linkedChildrenStatus[10];
        BLEClient* linkedChildrenClients[10];
        uint8_t linkedChildrenCount = 0;
        ParentPodAdvertisedDeviceCallbacks* pScanCallback;

        VMode* activeMode;

        bool acknowledgePod(BLEClient* client, BLEAddress* newPod);

    private:
        LEDManager* ledManager; 
        uint8_t currentStatus;

        void configureWebServer();
        void runScan();
};



class ParentPodAdvertisedDeviceCallbacks: public BLEAdvertisedDeviceCallbacks {
    protected:
        ParentPod* linkedParentPod;
        BLEScan* pBLEScan;
    
    public:
        BLEAdvertisedDevice* pendingRegistration;

        ParentPodAdvertisedDeviceCallbacks(ParentPod* pParentPod, BLEScan* pBLEScan)
        {
            this->linkedParentPod = pParentPod;
            this->pBLEScan = pBLEScan;
            this->pendingRegistration = nullptr;
        }

        

    
    void onResult(BLEAdvertisedDevice advertisedDevice) {
      // We have found a device, let us now see if it contains the service we are looking for.
      if (advertisedDevice.haveServiceUUID() && advertisedDevice.isAdvertisingService(BLEUUID(BLE_REACTION_POD_ID))) {
        Serial.println("Found child");
        this->pBLEScan->stop();
        BLEAddress serverAddress = advertisedDevice.getAddress();
        
        this->pendingRegistration = new BLEAdvertisedDevice(advertisedDevice);

      }
    }


};

#include "ParentPodWebServerHandlers.h"