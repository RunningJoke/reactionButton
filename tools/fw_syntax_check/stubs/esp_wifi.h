// Stub: ESP-IDF WiFi driver (only what the radio setup uses).
#pragma once
#include <stdint.h>
#include "esp_err.h"

typedef enum {
    WIFI_IF_STA = 0,
    WIFI_IF_AP,
    WIFI_IF_NAN,
    WIFI_IF_MAX
} wifi_interface_t;

typedef enum {
    WIFI_SECOND_CHAN_NONE = 0,
    WIFI_SECOND_CHAN_ABOVE,
    WIFI_SECOND_CHAN_BELOW
} wifi_second_chan_t;

typedef enum {
    WIFI_PS_NONE,
    WIFI_PS_MIN_MODEM,
    WIFI_PS_MAX_MODEM
} wifi_ps_type_t;

#ifdef __cplusplus
extern "C" {
#endif
esp_err_t esp_wifi_set_ps(wifi_ps_type_t type);
esp_err_t esp_wifi_set_channel(uint8_t primary, wifi_second_chan_t second);
esp_err_t esp_wifi_get_channel(uint8_t* primary, wifi_second_chan_t* second);
esp_err_t esp_wifi_set_max_tx_power(int8_t power);
#ifdef __cplusplus
}
#endif
