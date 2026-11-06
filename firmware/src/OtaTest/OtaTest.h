#pragma once
#include <ArduinoJson.h>

// THROWAWAY spike (#122): OTA transfer measurements. Not for merge.
namespace OtaTest {
    // true if op is a tOta... op (the response is filled)
    bool handle(const char* op, JsonObjectConst req, JsonDocument& res);
}
