// Stub: ESP-IDF Bluedroid GATT server API (only what the firmware uses).
#pragma once
#include <stdint.h>
#include "esp_bt_defs.h"

typedef uint8_t esp_gatt_if_t;
typedef uint16_t esp_gatt_conn_reason_t;

typedef enum {
    ESP_GATTS_MTU_EVT = 4,
    ESP_GATTS_CONNECT_EVT = 14,
    ESP_GATTS_DISCONNECT_EVT = 15
} esp_gatts_cb_event_t;

typedef union {
    struct {
        uint16_t conn_id;
        uint16_t mtu;
    } mtu;
    struct {
        uint16_t conn_id;
        uint8_t link_role;
        esp_bd_addr_t remote_bda;
    } connect;
    struct {
        uint16_t conn_id;
        esp_bd_addr_t remote_bda;
        esp_gatt_conn_reason_t reason;
    } disconnect;
} esp_ble_gatts_cb_param_t;

typedef void (*esp_gatts_cb_t)(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t* param);
