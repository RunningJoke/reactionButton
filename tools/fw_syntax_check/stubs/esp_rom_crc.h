// Stub: ESP-IDF ROM CRC functions.
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
uint32_t esp_rom_crc32_le(uint32_t crc, uint8_t const* buf, uint32_t len);
uint32_t esp_rom_crc16_le(uint16_t crc, uint8_t const* buf, uint32_t len);
uint8_t esp_rom_crc8_le(uint8_t crc, uint8_t const* buf, uint32_t len);
#ifdef __cplusplus
}
#endif
