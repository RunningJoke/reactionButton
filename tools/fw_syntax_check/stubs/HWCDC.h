// Stub of the ESP32-C3 USB-Serial-JTAG class used for `Console`.
#pragma once
#include "Print.h"

class HWCDC : public Stream {
public:
    void begin(unsigned long baud = 0) { (void)baud; }
    void end() {}
    size_t setRxBufferSize(size_t) { return 0; }
    size_t setTxBufferSize(size_t) { return 0; }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    size_t write(uint8_t) override { return 1; }
    size_t write(const uint8_t* b, size_t n) override { (void)b; return n; }
    using Print::write;
    void flush() override {}
    operator bool() const { return true; }
};
