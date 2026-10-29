#include "Console.h"
#include <esp_log.h>
#include "hal/usb_serial_jtag_ll.h"

HWCDC Console;
static int emptyFree = 0;     // availableForWrite() with nothing queued

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
    emptyFree = Console.availableForWrite();
    esp_log_set_vprintf(&logToConsole);
    // every ADC2 read of the battery (Battery.cpp) configures GPIO 5 again and would log a line at INFO
    esp_log_level_set("gpio", ESP_LOG_WARN);
}

void consoleKick() {
    static uint32_t lastKick = 0;
    uint32_t now = millis();
    if(now - lastKick < 10 || !HWCDC::isPlugged()) {
        return;
    }
    lastKick = now;
    if(Console.availableForWrite() >= emptyFree) {
        return;     // nothing queued
    }
    // as HWCDC::write does: push the FIFO out and let the ISR move the queued bytes
    usb_serial_jtag_ll_txfifo_flush();
    usb_serial_jtag_ll_ena_intr_mask(USB_SERIAL_JTAG_INTR_SERIAL_IN_EMPTY);
}
