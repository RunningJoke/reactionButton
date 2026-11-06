// Stub: ESP-IDF OTA (only what Ota uses).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"
#include "esp_partition.h"

#define OTA_WITH_SEQUENTIAL_WRITES 0xfffffffe
#define ESP_ERR_OTA_VALIDATE_FAILED 0x1503

typedef uint32_t esp_ota_handle_t;
typedef enum { ESP_OTA_IMG_NEW, ESP_OTA_IMG_PENDING_VERIFY, ESP_OTA_IMG_VALID, ESP_OTA_IMG_INVALID, ESP_OTA_IMG_ABORTED, ESP_OTA_IMG_UNDEFINED = -1 } esp_ota_img_states_t;

#ifdef __cplusplus
extern "C" {
#endif
esp_err_t esp_ota_begin(const esp_partition_t* partition, size_t image_size, esp_ota_handle_t* out_handle);
esp_err_t esp_ota_write(esp_ota_handle_t handle, const void* data, size_t size);
esp_err_t esp_ota_end(esp_ota_handle_t handle);
esp_err_t esp_ota_abort(esp_ota_handle_t handle);
esp_err_t esp_ota_set_boot_partition(const esp_partition_t* partition);
const esp_partition_t* esp_ota_get_running_partition(void);
esp_err_t esp_ota_get_state_partition(const esp_partition_t* partition, esp_ota_img_states_t* ota_state);
esp_err_t esp_ota_mark_app_valid_cancel_rollback(void);
esp_err_t esp_ota_mark_app_invalid_rollback_and_reboot(void);
const esp_partition_t* esp_ota_get_last_invalid_partition(void);
const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t* start_from);
#ifdef __cplusplus
}
#endif
