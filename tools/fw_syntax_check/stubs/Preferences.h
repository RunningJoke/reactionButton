// Stub: Arduino Preferences (NVS).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "Arduino.h"

class Preferences {
public:
    bool begin(const char* name, bool readOnly = false, const char* partition = nullptr) { (void)name; (void)readOnly; (void)partition; return true; }
    void end() {}
    bool clear() { return true; }
    bool remove(const char* key) { (void)key; return true; }
    bool isKey(const char* key) { (void)key; return false; }
    size_t putUChar(const char* key, uint8_t v) { (void)key; (void)v; return 1; }
    size_t putUShort(const char* key, uint16_t v) { (void)key; (void)v; return 2; }
    size_t putUInt(const char* key, uint32_t v) { (void)key; (void)v; return 4; }
    size_t putULong64(const char* key, uint64_t v) { (void)key; (void)v; return 8; }
    size_t putInt(const char* key, int32_t v) { (void)key; (void)v; return 4; }
    size_t putBool(const char* key, bool v) { (void)key; (void)v; return 1; }
    size_t putString(const char* key, const char* v) { (void)key; (void)v; return 0; }
    size_t putString(const char* key, String v) { (void)key; (void)v; return 0; }
    size_t putBytes(const char* key, const void* v, size_t len) { (void)key; (void)v; return len; }
    uint8_t getUChar(const char* key, uint8_t def = 0) { (void)key; return def; }
    uint16_t getUShort(const char* key, uint16_t def = 0) { (void)key; return def; }
    uint32_t getUInt(const char* key, uint32_t def = 0) { (void)key; return def; }
    uint64_t getULong64(const char* key, uint64_t def = 0) { (void)key; return def; }
    int32_t getInt(const char* key, int32_t def = 0) { (void)key; return def; }
    bool getBool(const char* key, bool def = false) { (void)key; return def; }
    String getString(const char* key, String def = String()) { (void)key; return def; }
    size_t getString(const char* key, char* value, size_t maxLen) { (void)key; (void)value; (void)maxLen; return 0; }
    size_t getBytes(const char* key, void* buf, size_t maxLen) { (void)key; (void)buf; (void)maxLen; return 0; }
};
