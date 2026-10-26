// Stub: ESP-NOW API of ESP-IDF 4.4 (espressif32@6.10.0, "newer platforms change the callback API":
// the receive callback is (mac, data, len); IDF 5 uses esp_now_recv_info_t).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"
#include "esp_wifi.h"

#define ESP_NOW_ETH_ALEN 6
#define ESP_NOW_KEY_LEN 16
#define ESP_NOW_MAX_DATA_LEN 250

typedef enum {
    ESP_NOW_SEND_SUCCESS = 0,
    ESP_NOW_SEND_FAIL
} esp_now_send_status_t;

typedef struct esp_now_peer_info {
    uint8_t peer_addr[ESP_NOW_ETH_ALEN];
    uint8_t lmk[ESP_NOW_KEY_LEN];
    uint8_t channel;
    wifi_interface_t ifidx;
    bool encrypt;
    void* priv;
} esp_now_peer_info_t;

typedef void (*esp_now_recv_cb_t)(const uint8_t* mac_addr, const uint8_t* data, int data_len);
typedef void (*esp_now_send_cb_t)(const uint8_t* mac_addr, esp_now_send_status_t status);

esp_err_t esp_now_init(void);
esp_err_t esp_now_deinit(void);
esp_err_t esp_now_register_recv_cb(esp_now_recv_cb_t cb);
esp_err_t esp_now_register_send_cb(esp_now_send_cb_t cb);
esp_err_t esp_now_send(const uint8_t* peer_addr, const uint8_t* data, size_t len);
esp_err_t esp_now_add_peer(const esp_now_peer_info_t* peer);
esp_err_t esp_now_del_peer(const uint8_t* peer_addr);
bool esp_now_is_peer_exist(const uint8_t* peer_addr);
