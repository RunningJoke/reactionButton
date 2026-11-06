// Stub: ESP-IDF partitions (only what Ota uses).
#pragma once
#include <stdint.h>
#include <stddef.h>

#define ESP_PARTITION_SUBTYPE_APP_OTA_MIN 0x10

typedef struct {
    int type;
    int subtype;
    uint32_t address;
    uint32_t size;
    char label[17];
} esp_partition_t;
