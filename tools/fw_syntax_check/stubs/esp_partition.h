// Stub: ESP-IDF partitions (only what Ota uses).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#define ESP_PARTITION_SUBTYPE_APP_OTA_MIN 0x10

typedef struct {
    int type;
    int subtype;
    uint32_t address;
    uint32_t size;
    char label[17];
} esp_partition_t;

#ifdef __cplusplus
extern "C" {
#endif
esp_err_t esp_partition_read(const esp_partition_t* partition, size_t src_offset, void* dst, size_t size);
#ifdef __cplusplus
}
#endif
