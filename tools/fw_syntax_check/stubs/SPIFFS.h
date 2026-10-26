// Stub: Arduino SPIFFS.
#pragma once
#include "FS.h"

class SPIFFSFS : public fs::FS {
public:
    bool begin(bool formatOnFail = false, const char* basePath = "/spiffs", uint8_t maxOpenFiles = 10,
               const char* partitionLabel = nullptr) {
        (void)formatOnFail; (void)basePath; (void)maxOpenFiles; (void)partitionLabel;
        return true;
    }
    void end() {}
    bool format() { return true; }
    size_t totalBytes() { return 0; }
    size_t usedBytes() { return 0; }
};
extern SPIFFSFS SPIFFS;
