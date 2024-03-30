#include "ChildPod.h"
#include <esp_now.h>

ChildPod::ChildPod(LEDManager* ledManager)
{
    this->ledManager = ledManager;
    this->currentStatus = 0;
    this->discoveryTries = 0;
    this->lastDiscoveryTry = 0;
}

int8_t ChildPod::update(uint64_t timestamp)
{
    switch(this->currentStatus) {
        case 0: //discoveryMode - check if a parent exists
            {
            if(lastDiscoveryTry + 1000UL <= timestamp) {
                Serial.println("Looking for Marco");
                const uint8_t data[] = "MARCO";
                

                //send again
                
                //@todo: ESP now not working, use BLE here

                lastDiscoveryTry = timestamp;

                //update LED ring
                this->ledManager->setLEDColors(this->discoveryTries , this->ledManager->BLUE);
                
                this->discoveryTries++;

                if(this->discoveryTries > 11) {
                    //switch to parent mode
                    Serial.println("I AM Marco");
                    this->currentStatus = 1;
                    return 2;
                }

                return 0;
            }
            break;
            }
        case 1: //no parent found, switch to parent mode
            return 2;

        case 2: //parent responded
            //run basic configuration based on parent data
            return 0; //return status code 0 to stay in child mode
    }

    return this->currentStatus;
    
}

void ChildPod::handleData(const uint8_t *data, int data_len)
{
    if(this->currentStatus == 0 && //looking for our parent
        data_len == 5 && 
        strcasecmp((char*)data, "POLO") == 0) {
            Serial.println("Found a Marco");
            this->currentStatus = 2; //parent was found, submit as child
        }
}

void ChildPod::start()
{
    ChildPodESPNowHandler::registerChildPod(this);

    esp_now_register_recv_cb(ChildPodESPNowHandler::receive);
    esp_now_register_send_cb(ChildPodESPNowHandler::transmit);

}

void ChildPod::stop()
{
    esp_now_unregister_recv_cb();
    esp_now_unregister_send_cb();
}