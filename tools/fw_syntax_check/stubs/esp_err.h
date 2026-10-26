// Stub: ESP-IDF error codes.
#pragma once
#include <stdint.h>

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_ESPNOW_BASE 0x3064
#define ESP_ERR_ESPNOW_NOT_INIT (ESP_ERR_ESPNOW_BASE + 1)
#define ESP_ERR_ESPNOW_ARG (ESP_ERR_ESPNOW_BASE + 2)
#define ESP_ERR_ESPNOW_NO_MEM (ESP_ERR_ESPNOW_BASE + 3)
#define ESP_ERR_ESPNOW_FULL (ESP_ERR_ESPNOW_BASE + 4)
#define ESP_ERR_ESPNOW_NOT_FOUND (ESP_ERR_ESPNOW_BASE + 5)
#define ESP_ERR_ESPNOW_INTERNAL (ESP_ERR_ESPNOW_BASE + 6)
#define ESP_ERR_ESPNOW_EXIST (ESP_ERR_ESPNOW_BASE + 7)
#define ESP_ERR_ESPNOW_IF (ESP_ERR_ESPNOW_BASE + 8)

#ifdef __cplusplus
extern "C" {
#endif
const char* esp_err_to_name(esp_err_t code);
#ifdef __cplusplus
}
#endif
