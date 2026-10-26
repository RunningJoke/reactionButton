// Stub: ESP-IDF Bluedroid GAP API (only what the firmware uses).
#pragma once
#include <stdint.h>
#include "esp_err.h"
#include "esp_bt_defs.h"

#define ESP_BLE_ADV_FLAG_LIMIT_DISC 0x01
#define ESP_BLE_ADV_FLAG_GEN_DISC 0x02
#define ESP_BLE_ADV_FLAG_BREDR_NOT_SPT 0x04
#define ESP_BLE_ADV_FLAG_DMT_CONTROLLER_SPT 0x08
#define ESP_BLE_ADV_FLAG_DMT_HOST_SPT 0x10
#define ESP_BLE_ADV_FLAG_NON_LIMIT_DISC 0x00

typedef enum {
    ESP_BLE_AD_TYPE_FLAG = 0x01,
    ESP_BLE_AD_TYPE_NAME_CMPL = 0x09,
    ESP_BLE_AD_TYPE_INT_RANGE = 0x12,
    ESP_BLE_AD_MANUFACTURER_SPECIFIC_TYPE = 0xFF
} esp_ble_adv_data_type;

typedef enum {
    ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT = 20,
    ESP_GAP_BLE_ADV_START_COMPLETE_EVT = 6
} esp_gap_ble_cb_event_t;

typedef struct {
    esp_bd_addr_t bda;
    uint16_t min_int;
    uint16_t max_int;
    uint16_t latency;
    uint16_t timeout;
} esp_ble_conn_update_params_t;

typedef union {
    struct {
        esp_bt_status_t status;
        esp_bd_addr_t bda;
        uint16_t min_int;
        uint16_t max_int;
        uint16_t conn_int;
        uint16_t latency;
        uint16_t timeout;
    } update_conn_params;
} esp_ble_gap_cb_param_t;

typedef void (*esp_gap_ble_cb_t)(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t* param);

esp_err_t esp_ble_gap_update_conn_params(esp_ble_conn_update_params_t* params);
esp_err_t esp_ble_gap_set_device_name(const char* name);
