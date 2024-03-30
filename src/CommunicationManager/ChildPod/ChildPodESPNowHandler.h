#pragma once

#include <esp_now.h>
#include "ChildPod.h"


class ChildPodESPNowHandler {
    private:
        static ChildPod* childPod;
    public:
        static void registerChildPod(ChildPod* childPod);
        static void receive(const uint8_t *mac_addr, const uint8_t *data, int data_len);
        static void transmit(const uint8_t *mac_addr, esp_now_send_status_t status);
};