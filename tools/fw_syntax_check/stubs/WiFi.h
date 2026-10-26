// Stub: Arduino WiFi (STA mode switch and MAC address only).
#pragma once
#include <stdint.h>
#include "Arduino.h"

typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA, WIFI_MODE_AP, WIFI_MODE_APSTA, WIFI_MODE_MAX } wifi_mode_t;
#define WIFI_OFF WIFI_MODE_NULL
#define WIFI_STA WIFI_MODE_STA
#define WIFI_AP WIFI_MODE_AP
#define WIFI_AP_STA WIFI_MODE_APSTA

class WiFiClass {
public:
    bool mode(wifi_mode_t) { return true; }
    bool disconnect(bool wifioff = false, bool eraseap = false) { (void)wifioff; (void)eraseap; return true; }
    String macAddress() { return String(); }
    uint8_t* macAddress(uint8_t* mac) { return mac; }
};
extern WiFiClass WiFi;
