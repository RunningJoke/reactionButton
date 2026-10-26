// Stub of Arduino Print / Stream.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "WString.h"

class Print {
public:
    virtual ~Print() {}
    virtual size_t write(uint8_t) = 0;
    virtual size_t write(const uint8_t* buf, size_t n) { size_t c = 0; while (n--) c += write(*buf++); return c; }
    size_t write(const char* s) { return s ? write((const uint8_t*)s, strlen(s)) : 0; }
    size_t write(const char* s, size_t n) { return write((const uint8_t*)s, n); }
    size_t print(const char*) { return 0; }
    size_t print(const String&) { return 0; }
    size_t print(char) { return 0; }
    size_t print(int, int = 10) { return 0; }
    size_t print(unsigned int, int = 10) { return 0; }
    size_t print(long, int = 10) { return 0; }
    size_t print(unsigned long, int = 10) { return 0; }
    size_t print(double, int = 2) { return 0; }
    size_t println() { return 0; }
    size_t println(const char*) { return 0; }
    size_t println(const String&) { return 0; }
    size_t println(char) { return 0; }
    size_t println(int, int = 10) { return 0; }
    size_t println(unsigned int, int = 10) { return 0; }
    size_t println(long, int = 10) { return 0; }
    size_t println(unsigned long, int = 10) { return 0; }
    size_t println(double, int = 2) { return 0; }
    size_t printf(const char* fmt, ...) __attribute__((format(printf, 2, 3))) { (void)fmt; return 0; }
    virtual int availableForWrite() { return 0; }
    virtual void flush() {}
};

class Stream : public Print {
public:
    virtual int available() = 0;
    virtual int read() = 0;
    virtual int peek() = 0;
    size_t readBytes(char* buf, size_t n) { (void)buf; (void)n; return 0; }
    size_t readBytes(uint8_t* buf, size_t n) { (void)buf; (void)n; return 0; }
    String readString() { return String(); }
    String readStringUntil(char) { return String(); }
    void setTimeout(unsigned long) {}
};
