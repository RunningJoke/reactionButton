// Host definitions of the ESP-IDF functions declared in tools/fw_syntax_check/stubs (logging only).
#include <stdio.h>
#include <stdarg.h>
#include "esp_log.h"

extern "C" void esp_log_write(esp_log_level_t, const char*, const char*, ...) {
}
