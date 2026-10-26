// Stub: Arduino FS (File as used by the firmware: SPIFFS read / write / directory walk).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "Arduino.h"

#define FILE_READ "r"
#define FILE_WRITE "w"
#define FILE_APPEND "a"

enum SeekMode { SeekSet = 0, SeekCur = 1, SeekEnd = 2 };

namespace fs {

class File : public Stream {
public:
    File() {}
    size_t write(uint8_t) override { return 1; }
    size_t write(const uint8_t* buf, size_t size) override { (void)buf; return size; }
    using Print::write;
    int available() override { return 0; }
    int read() override { return -1; }
    size_t read(uint8_t* buf, size_t size) { (void)buf; (void)size; return 0; }
    int peek() override { return -1; }
    void flush() override {}
    bool seek(uint32_t pos, SeekMode mode = SeekSet) { (void)pos; (void)mode; return true; }
    size_t position() const { return 0; }
    size_t size() const { return 0; }
    void close() {}
    operator bool() const { return false; }
    const char* path() const { return ""; }
    const char* name() const { return ""; }
    bool isDirectory() { return false; }
    File openNextFile(const char* mode = FILE_READ) { (void)mode; return File(); }
    time_t getLastWrite() { return 0; }
};

class FS {
public:
    File open(const char* path, const char* mode = FILE_READ, const bool create = false) { (void)path; (void)mode; (void)create; return File(); }
    File open(const String& path, const char* mode = FILE_READ, const bool create = false) { (void)path; (void)mode; (void)create; return File(); }
    bool exists(const char* path) { (void)path; return false; }
    bool exists(const String& path) { (void)path; return false; }
    bool remove(const char* path) { (void)path; return false; }
    bool remove(const String& path) { (void)path; return false; }
    bool rename(const char* from, const char* to) { (void)from; (void)to; return false; }
    bool rename(const String& from, const String& to) { (void)from; (void)to; return false; }
    bool mkdir(const char* path) { (void)path; return false; }
    bool rmdir(const char* path) { (void)path; return false; }
};

}  // namespace fs

using fs::File;
using fs::FS;
