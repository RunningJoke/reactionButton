#pragma once

#include <ArduinoJson.h>
#include "Ota/OtaRules.h"
#include "Ota/OtaBitmap.h"

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

    // Call at boot: settles info.ota.lastResult and notes whether this image is on trial (PENDING_VERIFY, #124)
    void boot();

    // Once per loop pass: runs the self-test of an image on trial once, discards an update that has been idle for too long, gives the ring back after UPDATE_FAILED
    void service();

    // An update has begun and is not over (receiving, verifying or verified): no power-off, no program selection
    bool busy();

    // The ops; they fill the response. opActivate returns true when the pod has to restart now.
    void opBegin(JsonObjectConst request, JsonDocument& response);
    void opWrite(JsonObjectConst request, JsonDocument& response);
    void opEnd(JsonDocument& response);
    bool opActivate(JsonDocument& response);
    void opAbort(JsonDocument& response);

    // --- distribution over ESP-NOW (#130, #131, #132) ---

    // Central: the verified image, served to the peripherals (path "@ota") and offered to them
    bool imageReady();
    uint32_t imageSize();
    const char* imageSha();             // 64 hex characters
    const char* imageVersion();         // "" = not given
    uint8_t imageLinkProtocol();        // of the new firmware (otaBegin linkProtocol), 0 = not given
    bool readImage(uint32_t offset, uint8_t* out, size_t max, size_t& length, uint32_t& total);
    void keepAlive();                   // distributing is not an idle update

    // Peripheral: the image arrives from the central, chunk by chunk in any order (OtaBitmap)
    enum class RadioBegin : uint8_t { OK, BUSY, LOW_BATTERY, TOO_LARGE, STORAGE };
    // Erases the whole slot (about 4 s, the loop and the radio stand still). OK as well if this image is already open.
    RadioBegin radioBegin(uint32_t size, const char* sha256Hex, const char* version);
    bool viaRadio();                    // an update from the central is open (receiving, ready or failed)
    bool radioIs(uint32_t size, const char* sha256Hex);     // ... and it is this image
    OtaRules::State currentState();
    bool radioChunk(uint16_t index, const uint8_t* data, size_t length);     // true if it was new and written
    int32_t radioNextMissing(uint16_t from);
    bool radioComplete();
    uint8_t radioPercent();
    void radioFinish();                 // all chunks there: SHA-256 from the flash, image check, then ready or failed
    void radioAbort();                  // discard; the caller shows the ring

    void describeStatus(JsonObject status);     // status.ota
    void describeInfo(JsonObject info);         // info.ota
}
