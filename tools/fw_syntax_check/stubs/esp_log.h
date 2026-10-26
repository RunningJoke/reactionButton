// Stub: ESP-IDF logging.
#pragma once
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>

typedef int (*vprintf_like_t)(const char*, va_list);

typedef enum {
    ESP_LOG_NONE,
    ESP_LOG_ERROR,
    ESP_LOG_WARN,
    ESP_LOG_INFO,
    ESP_LOG_DEBUG,
    ESP_LOG_VERBOSE
} esp_log_level_t;

#ifdef __cplusplus
extern "C" {
#endif
vprintf_like_t esp_log_set_vprintf(vprintf_like_t func);
void esp_log_level_set(const char* tag, esp_log_level_t level);
uint32_t esp_log_timestamp(void);
void esp_log_write(esp_log_level_t level, const char* tag, const char* format, ...)
    __attribute__((format(printf, 3, 4)));
#ifdef __cplusplus
}
#endif

#define ESP_LOGE(tag, format, ...) esp_log_write(ESP_LOG_ERROR, tag, format, ##__VA_ARGS__)
#define ESP_LOGW(tag, format, ...) esp_log_write(ESP_LOG_WARN, tag, format, ##__VA_ARGS__)
#define ESP_LOGI(tag, format, ...) esp_log_write(ESP_LOG_INFO, tag, format, ##__VA_ARGS__)
#define ESP_LOGD(tag, format, ...) esp_log_write(ESP_LOG_DEBUG, tag, format, ##__VA_ARGS__)
#define ESP_LOGV(tag, format, ...) esp_log_write(ESP_LOG_VERBOSE, tag, format, ##__VA_ARGS__)
