#include "Console.h"
#include <esp_log.h>

HWCDC Console;

static int logToConsole(const char* format, va_list args) {
    char buffer[256];
    int len = vsnprintf(buffer, sizeof(buffer), format, args);
    if(len > 0) {
        Console.write((const uint8_t*)buffer, std::min((size_t)len, sizeof(buffer) - 1));
    }
    return len;
}

void consoleBegin() {
    Console.setTxBufferSize(4096);
    Console.setRxBufferSize(4096);
    Console.begin();
    esp_log_set_vprintf(&logToConsole);
}
