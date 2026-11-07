#include "Ota.h"
#include <algorithm>
#include <esp_ota_ops.h>
#include <SPIFFS.h>
#include <NimBLEDevice.h>
#include <esp_partition.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include "Config/ConfigApi.h"
#include "LEDManager/LEDManager.h"
#include "Roles/RoleManager.h"
#include "Settings/Settings.h"
#include "Battery/Battery.h"
#include "Link/EspNowLink.h"
#include "Config/Console.h"

using namespace OtaRules;

namespace {
    // How the slot is erased. Sequential: esp_ota_begin returns at once and esp_ota_write erases each 4 KB sector
    // just before writing it (1.1 MB over USB: 30 s). It needs the lossless, in-order stream of this path.
    // Full-size erase (1.1 MB over USB: 4.4 s wait in otaBegin + 13 s) is this one line; decide with the BLE numbers (#122).
    const bool ERASE_SEQUENTIAL = true;

    const uint8_t RESULT_NONE = 0, RESULT_OK = 1, RESULT_ROLLED_BACK = 2;
    const size_t MAX_BASE64 = (Ota::MAX_CHUNK + 2) / 3 * 4;
    const size_t MAX_VERSION = 31;

    // An image that was just activated must stay up this long and pass selfTest() before it is marked valid (#124)
    const uint32_t SELF_TEST_MS = 15000;
    bool onTrial = false;           // the running image is PENDING_VERIFY: the bootloader drops it at the next reset

    State state = State::IDLE;
    const esp_partition_t* target = nullptr;
    esp_ota_handle_t handle = 0;
    uint32_t total = 0;
    uint32_t received = 0;
    char sha[65] = "";
    char version[MAX_VERSION + 1] = "";
    uint8_t linkProtocol = 0;       // of the new firmware, from otaBegin (0 = not given): decides whether otaActivate may force
    bool radio = false;             // the update comes from the central over ESP-NOW (a peripheral)
    OtaBitmap bitmap;               // radio: the chunks that are in the slot
    mbedtls_sha256_context hash;
    uint32_t lastActivityMs = 0;
    uint32_t restoreAtMs = 0;       // after UPDATE_FAILED: the ring of the role again (0 = none due)

    int slotIndex(const esp_partition_t* partition) {
        return partition == nullptr ? 0 : partition->subtype - ESP_PARTITION_SUBTYPE_APP_OTA_MIN + 1;
    }

    bool runningOnTrial() {
        esp_ota_img_states_t imageState;
        return esp_ota_get_state_partition(esp_ota_get_running_partition(), &imageState) == ESP_OK
            && imageState == ESP_OTA_IMG_PENDING_VERIFY;
    }

    // What must be up in every ordinary situation: no phone, no peripheral, no program is not a failure.
    // The central's ESP-NOW radio is off in the menu (#122), so it is not tested there; its BLE service is.
    bool selfTest() {
        IRole* role = RoleManager::getManager()->current();
        if(role == nullptr || SPIFFS.totalBytes() == 0) {
            return false;
        }
        return strcmp(role->name(), "central") == 0 ? NimBLEDevice::getInitialized() : EspNowLink::get().isStarted();
    }

    // Verdict on an image on trial. Nothing to roll back to (USB-flashed pod, other slot erased): the call returns
    // and the image is kept, so the pod never boot-loops.
    void judge() {
        onTrial = false;
        if(!selfTest()) {
            Console.println("OTA self-test failed, rolling back");
            esp_ota_mark_app_invalid_rollback_and_reboot();
            Console.println("OTA rollback impossible, keeping this image");
        }
        if(Settings::getOtaPending() != 0) {
            Settings::setOtaResult(RESULT_OK);
            Settings::setOtaPending(0);
        }
        esp_ota_mark_app_valid_cancel_rollback();
    }

    void restoreRing() {
        IRole* role = RoleManager::getManager()->current();
        if(role != nullptr) {
            role->otaEnded();
        }
    }

    void closeImage() {
        if(handle != 0) {
            esp_ota_abort(handle);
            handle = 0;
        }
        mbedtls_sha256_free(&hash);
    }

    void reset() {
        closeImage();
        state = State::IDLE;
        total = received = 0;
        sha[0] = version[0] = '\0';
        linkProtocol = 0;
        radio = false;
    }

    // the update is over with an error: the old firmware keeps running, the ring blinks, then the role shows itself
    void markFailed() {
        closeImage();
        state = State::FAILED;
        LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE_FAILED);
        restoreAtMs = millis() + SystemPattern::durationMs(SystemPattern::Id::UPDATE_FAILED, SystemPattern::Args()) + 1;
    }

    void fail(JsonDocument& response, const char* code, const String& message) {
        markFailed();
        ConfigApi::setError(response, code, message);
    }

    bool notReady(JsonDocument& response, const char* what) {
        ConfigApi::setError(response, "not_ready", String(what) + " (update state " + stateName(state) + ")");
        return false;
    }
}

bool Ota::isOp(const char* op) {
    return strcmp(op, "otaBegin") == 0 || strcmp(op, "otaWrite") == 0 || strcmp(op, "otaDistribute") == 0 || strcmp(op, "otaEnd") == 0
        || strcmp(op, "otaActivate") == 0 || strcmp(op, "otaAbort") == 0;
}

bool Ota::busy() {
    return inProgress(state);
}

// lastResult: otaActivate leaves the slot in NVS (pending). The boot after it settles the result:
//  - the slot runs and is on trial: wait, service() decides after the self-test;
//  - the slot runs and is valid: ok;
//  - another slot runs and the bootloader has marked the pending one invalid or aborted (panic, reset inside
//    the trial window, failed self-test): rolledBack. The invalid-slot check keeps a stale entry from a pod
//    that was flashed over USB in between from reporting a rollback.
// Kept until the next otaBegin.
void Ota::boot() {
    onTrial = runningOnTrial();
    uint8_t pendingRole = Settings::getOtaPending() >> 4;       // the role the pod had when it activated (1 central, 2 peripheral)
    uint8_t pending = Settings::getOtaPending() & 0x0F;
    if(pending == 0 || (pending == slotIndex(esp_ota_get_running_partition()) && onTrial)) {
        return;
    }
    if(pending == slotIndex(esp_ota_get_running_partition())) {
        Settings::setOtaResult(RESULT_OK);
    } else if(slotIndex(esp_ota_get_last_invalid_partition()) == pending) {
        Settings::setOtaResult(RESULT_ROLLED_BACK);
        if(pendingRole != 0) {
            Settings::setBootRole(pendingRole);     // the failed boot used up the role of otaActivate: the old image starts in it again
        }
    }
    Settings::setOtaPending(0);
}

// Replaces the weak, unconditional one in the Arduino core (esp32-hal-misc.c): initArduino() then leaves a
// PENDING_VERIFY image alone and judge() decides.
extern "C" bool verifyRollbackLater() {
    return true;
}

void Ota::service() {
    uint32_t now = millis();
    if(onTrial && now >= SELF_TEST_MS) {
        judge();
    }
    if(inProgress(state) && !radio && expired(now, lastActivityMs)) {      // a radio update lasts as long as the central distributes
        reset();
        restoreRing();
    }
    if(restoreAtMs != 0 && (int32_t)(now - restoreAtMs) >= 0) {
        restoreAtMs = 0;
        restoreRing();
    }
}

void Ota::opBegin(JsonObjectConst request, JsonDocument& response) {
    IRole* role = RoleManager::getManager()->current();
    if(role == nullptr || !role->otaAllowed()) {
        ConfigApi::setError(response, "busy", "a firmware update needs the menu (central) or a pod not in a game");
        return;
    }
    if(!request["size"].is<uint32_t>() || request["size"].as<uint32_t>() == 0) {
        ConfigApi::setError(response, "bad_request", "'size' (bytes of the image, > 0) missing");
        return;
    }
    uint32_t size = request["size"].as<uint32_t>();
    const char* hex = request["sha256"] | "";
    if(!isSha256Hex(hex)) {
        ConfigApi::setError(response, "bad_request", "'sha256' (64 hex characters) missing");
        return;
    }
    JsonVariantConst name = request["version"];
    if(!name.isNull() && (!name.is<const char*>() || strlen(name.as<const char*>()) > MAX_VERSION)) {
        ConfigApi::setError(response, "bad_request", "'version' must be a string of at most 31 characters");
        return;
    }
    if(!batteryAllows(Battery::known(), Battery::percent())) {
        ConfigApi::setError(response, "low_battery",
            String("battery at ") + Battery::percent() + " %, an update needs " + MIN_BATTERY_PERCENT + " %");
        return;
    }
    if(onTrial) {
        ConfigApi::setError(response, "busy", "the running firmware is still being tested (15 s after an update), try again");
        return;
    }
    const esp_partition_t* slot = esp_ota_get_next_update_partition(nullptr);
    if(slot == nullptr) {
        ConfigApi::setError(response, "storage", "no slot for an update");
        return;
    }
    if(size > slot->size) {
        ConfigApi::setError(response, "too_large", String("image larger than the slot (") + (uint32_t)slot->size + " bytes)");
        return;
    }

    JsonVariantConst link = request["linkProtocol"];
    if(!link.isNull() && (!link.is<uint32_t>() || link.as<uint32_t>() == 0 || link.as<uint32_t>() > 255)) {
        ConfigApi::setError(response, "bad_request", "'linkProtocol' must be a number from 1 to 255");
        return;
    }

    lastActivityMs = millis();
    restoreAtMs = 0;
    if(!resumes(state, total, sha, size, hex)) {
        reset();
        Settings::setOtaResult(RESULT_NONE);
        esp_err_t err = esp_ota_begin(slot, ERASE_SEQUENTIAL ? OTA_WITH_SEQUENTIAL_WRITES : size, &handle);
        if(err != ESP_OK) {
            handle = 0;
            fail(response, "storage", String("esp_ota_begin: ") + esp_err_to_name(err));   // also ends a replaced update's ring
            return;
        }
        target = slot;
        total = size;
        snprintf(sha, sizeof(sha), "%s", hex);
        snprintf(version, sizeof(version), "%s", name | "");
        mbedtls_sha256_init(&hash);
        mbedtls_sha256_starts_ret(&hash, 0);
        state = State::RECEIVING;
        SystemPattern::Args args;
        args.percent = 0;
        LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE, args);
    }
    if(!link.isNull()) {
        linkProtocol = link.as<uint8_t>();
    }
    response["ok"] = true;
    response["slotSize"] = (uint32_t)slot->size;
    response["maxChunk"] = (uint32_t)MAX_CHUNK;
    response["received"] = received;
}

void Ota::opWrite(JsonObjectConst request, JsonDocument& response) {
    if(state != State::RECEIVING) {
        notReady(response, "no update is receiving, send otaBegin first");
        return;
    }
    if(!request["offset"].is<uint32_t>() || !request["data"].is<const char*>()) {
        ConfigApi::setError(response, "bad_request", "'offset' (number) and 'data' (base64 string) needed");
        return;
    }
    uint32_t offset = request["offset"].as<uint32_t>();
    const char* text = request["data"].as<const char*>();
    size_t textLength = strlen(text);
    if(textLength > MAX_BASE64) {
        ConfigApi::setError(response, "bad_request", String("'data' longer than maxChunk (") + (uint32_t)Ota::MAX_CHUNK + " bytes)");
        return;
    }
    uint8_t* raw = (uint8_t*)malloc(Ota::MAX_CHUNK);
    if(raw == nullptr) {
        ConfigApi::setError(response, "busy", "out of memory, try again");
        return;
    }
    size_t length = 0;
    if(mbedtls_base64_decode(raw, Ota::MAX_CHUNK, &length, (const uint8_t*)text, textLength) != 0) {
        free(raw);
        ConfigApi::setError(response, "bad_request", "'data' is not valid base64 or larger than maxChunk");
        return;
    }

    WriteCheck check = checkWrite(state, received, total, offset, length);
    if(check != WriteCheck::OK) {
        free(raw);
        if(check == WriteCheck::EMPTY) {
            ConfigApi::setError(response, "bad_request", "'data' is empty");
        } else if(check == WriteCheck::TOO_LARGE) {
            ConfigApi::setError(response, "too_large", String("data past the announced size ") + total);
        } else {
            ConfigApi::setError(response, "bad_offset", String("expected offset ") + received);
            response["received"] = received;
        }
        return;
    }

    esp_err_t err = esp_ota_write(handle, raw, length);
    if(err == ESP_OK) {
        mbedtls_sha256_update_ret(&hash, raw, length);      // in order, so the hash follows the writes
    }
    free(raw);
    if(err != ESP_OK) {
        // the first chunk must be an image header (ESP_ERR_OTA_VALIDATE_FAILED); anything else is flash
        fail(response, err == ESP_ERR_OTA_VALIDATE_FAILED ? "ota_failed" : "storage", String("esp_ota_write: ") + esp_err_to_name(err));
        return;
    }
    received += length;
    lastActivityMs = millis();
    SystemPattern::updateProgress(percent(received, total));
    response["ok"] = true;
    response["received"] = received;
}

void Ota::opEnd(JsonDocument& response) {
    if(state != State::RECEIVING) {
        notReady(response, "no update is receiving");
        return;
    }
    if(received != total) {
        ConfigApi::setError(response, "not_ready", String("received ") + received + " of " + total + " bytes");
        return;
    }
    state = State::VERIFYING;     // about 150 ms: the bar stays, a pattern for that long would only be a blip

    uint8_t digest[32];
    mbedtls_sha256_finish_ret(&hash, digest);
    if(!hexMatches(sha, digest)) {
        fail(response, "ota_failed", "SHA-256 of the received image differs from 'sha256'");
        return;
    }
    esp_err_t err = esp_ota_end(handle);
    handle = 0;
    if(err != ESP_OK) {
        fail(response, "ota_failed", String("image rejected: ") + esp_err_to_name(err));
        return;
    }
    state = State::READY;
    lastActivityMs = millis();
    LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE_READY);
    response["ok"] = true;
}

bool Ota::opActivate(JsonDocument& response) {
    if(state != State::READY) {
        return notReady(response, "no verified image, send otaEnd first");
    }
    esp_err_t err = esp_ota_set_boot_partition(target);
    if(err != ESP_OK) {
        ConfigApi::setError(response, "storage", String("esp_ota_set_boot_partition: ") + esp_err_to_name(err));
        return false;
    }
    IRole* role = RoleManager::getManager()->current();
    uint8_t bootRole = role != nullptr && strcmp(role->name(), "central") == 0 ? 1 : 2;
    Settings::setBootRole(bootRole);   // the role comes back without the button
    Settings::setOtaPending((uint8_t)(slotIndex(target) | bootRole << 4));      // role too: a rollback needs it
    response["ok"] = true;
    return true;
}

bool Ota::imageReady() { return state == State::READY; }
uint32_t Ota::imageSize() { return total; }
const char* Ota::imageSha() { return sha; }
const char* Ota::imageVersion() { return version; }
uint8_t Ota::imageLinkProtocol() { return linkProtocol; }
void Ota::keepAlive() { lastActivityMs = millis(); }

bool Ota::readImage(uint32_t offset, uint8_t* out, size_t max, size_t& length, uint32_t& size) {
    size = total;
    length = 0;
    if(state != State::READY || offset > total) {
        return false;
    }
    length = std::min((size_t)(total - offset), max);
    return esp_partition_read(target, offset, out, length) == ESP_OK;
}

Ota::RadioBegin Ota::radioBegin(uint32_t size, const char* hex, const char* name) {
    if(radioIs(size, hex)) {
        return RadioBegin::OK;          // the offer is repeated until the pod reports a state
    }
    if(!isSha256Hex(hex) || OtaBitmap::chunkCount(size) > OtaBitmap::MAX_CHUNKS) {
        return RadioBegin::TOO_LARGE;
    }
    if((inProgress(state) && !radio) || onTrial) {
        return RadioBegin::BUSY;
    }
    if(!batteryAllows(Battery::known(), Battery::percent())) {
        return RadioBegin::LOW_BATTERY;
    }
    const esp_partition_t* slot = esp_ota_get_next_update_partition(nullptr);
    if(slot == nullptr || size > slot->size) {
        return RadioBegin::TOO_LARGE;
    }

    reset();
    Settings::setOtaResult(RESULT_NONE);
    radio = true;
    lastActivityMs = millis();
    restoreAtMs = 0;
    snprintf(sha, sizeof(sha), "%s", hex);
    snprintf(version, sizeof(version), "%s", name);
    total = size;
    bitmap.reset(size);
    target = slot;
    SystemPattern::Args args;
    args.percent = 0;
    LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE, args);
    // the whole slot at once: chunks arrive in any order, which OTA_WITH_SEQUENTIAL_WRITES cannot take
    esp_err_t err = esp_ota_begin(slot, size, &handle);
    if(err != ESP_OK) {
        handle = 0;
        markFailed();
        return RadioBegin::STORAGE;
    }
    state = State::RECEIVING;
    return RadioBegin::OK;
}

bool Ota::viaRadio() { return radio && state != State::IDLE; }
bool Ota::radioIs(uint32_t size, const char* hex) { return viaRadio() && size == total && strcasecmp(hex, sha) == 0; }
OtaRules::State Ota::currentState() { return state; }
bool Ota::radioComplete() { return radio && bitmap.complete(); }
uint8_t Ota::radioPercent() { return state == State::READY ? 100 : bitmap.percent(); }
int32_t Ota::radioNextMissing(uint16_t from) { return bitmap.nextMissing(from); }

bool Ota::radioChunk(uint16_t index, const uint8_t* data, size_t length) {
    if(!radio || state != State::RECEIVING || bitmap.has(index) || length != OtaBitmap::chunkLength(index, total)) {
        return false;
    }
    if(esp_ota_write_with_offset(handle, data, length, OtaBitmap::chunkOffset(index)) != ESP_OK) {
        markFailed();
        return false;
    }
    bitmap.set(index);
    received = bitmap.bytes();
    lastActivityMs = millis();
    SystemPattern::updateProgress(bitmap.percent());
    return true;
}

void Ota::radioFinish() {
    if(!radio || state != State::RECEIVING || !bitmap.complete()) {
        return;
    }
    state = State::VERIFYING;
    mbedtls_sha256_context check;
    mbedtls_sha256_init(&check);
    mbedtls_sha256_starts_ret(&check, 0);
    uint8_t buffer[512];
    for(uint32_t offset = 0; offset < total; offset += sizeof(buffer)) {
        size_t n = std::min((size_t)(total - offset), sizeof(buffer));
        if(esp_partition_read(target, offset, buffer, n) != ESP_OK) {
            mbedtls_sha256_free(&check);
            markFailed();
            return;
        }
        mbedtls_sha256_update_ret(&check, buffer, n);
    }
    uint8_t digest[32];
    mbedtls_sha256_finish_ret(&check, digest);
    mbedtls_sha256_free(&check);
    if(!hexMatches(sha, digest)) {
        markFailed();
        return;
    }
    esp_err_t err = esp_ota_end(handle);
    handle = 0;
    if(err != ESP_OK) {
        markFailed();
        return;
    }
    state = State::READY;
    lastActivityMs = millis();
    LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE_READY);
}

void Ota::radioAbort() {
    reset();
    restoreAtMs = 0;
}

void Ota::opAbort(JsonDocument& response) {
    bool shown = inProgress(state) || restoreAtMs != 0;
    reset();
    restoreAtMs = 0;
    if(shown) {
        restoreRing();
    }
    response["ok"] = true;
}

void Ota::describeStatus(JsonObject status) {
    JsonObject ota = status["ota"].to<JsonObject>();
    ota["state"] = stateName(state);
    ota["received"] = received;
    ota["total"] = total;
    ota["version"] = version;
}

void Ota::describeInfo(JsonObject info) {
    const esp_partition_t* slot = esp_ota_get_next_update_partition(nullptr);
    const esp_partition_t* running = esp_ota_get_running_partition();
    JsonObject ota = info["ota"].to<JsonObject>();
    ota["slotSize"] = slot != nullptr ? (uint32_t)slot->size : 0;
    ota["running"] = running != nullptr ? running->label : "";
    uint8_t result = Settings::getOtaResult();
    ota["lastResult"] = result == RESULT_OK ? "ok" : result == RESULT_ROLLED_BACK ? "rolledBack" : "none";
}
