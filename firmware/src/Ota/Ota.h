#pragma once

#include <ArduinoJson.h>
#include "Ota/OtaRules.h"

/**
 * Firmware update over the config API (#123, docs/firmware/config-api.md "Firmware update", ADR 0009).
 *
 * The image is streamed into the inactive app slot (esp_ota_write), hashed on the way, checked by otaEnd and
 * selected by otaActivate. One update at a time per pod, kept in RAM: a reboot discards it, a dropped
 * connection does not (otaBegin with the same size and hash resumes it).
 *
 * Roles: IRole::otaAllowed says whether an update may begin, IRole::otaEnded gives the ring back.
 */
namespace Ota {
    // Raw bytes per otaWrite (info / otaBegin.maxChunk): 4096 base64 characters
    const size_t MAX_CHUNK = 3072;

    bool isOp(const char* op);

    // Call at boot: the outcome of the last otaActivate (info.ota.lastResult)
    void boot();

    // Once per loop pass: discards an update that has been idle for too long, gives the ring back after UPDATE_FAILED
    void service();

    // An update has begun and is not over (receiving, verifying or verified): no power-off, no program selection
    bool busy();

    // The ops; they fill the response. opActivate returns true when the pod has to restart now.
    void opBegin(JsonObjectConst request, JsonDocument& response);
    void opWrite(JsonObjectConst request, JsonDocument& response);
    void opEnd(JsonDocument& response);
    bool opActivate(JsonDocument& response);
    void opAbort(JsonDocument& response);

    void describeStatus(JsonObject status);     // status.ota
    void describeInfo(JsonObject info);         // info.ota
}
