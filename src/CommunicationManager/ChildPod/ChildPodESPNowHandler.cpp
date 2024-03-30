#include "ChildPodESPNowHandler.h"

ChildPod* ChildPodESPNowHandler::childPod = nullptr;

void ChildPodESPNowHandler::registerChildPod(ChildPod* childPod)
{
    ChildPodESPNowHandler::childPod = childPod;
}

void ChildPodESPNowHandler::receive(const uint8_t *mac_addr, const uint8_t *data, int data_len)
{
    ChildPodESPNowHandler::childPod->handleData(data, data_len);
}

void ChildPodESPNowHandler::transmit(const uint8_t *mac_addr, esp_now_send_status_t status)
{

}
