#include "Ota.h"
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include "Config/ConfigApi.h"
#include "LEDManager/LEDManager.h"
#include "Roles/RoleManager.h"
#include "Settings/Settings.h"
#include "Battery/Battery.h"

using namespace OtaRules;

namespace {
    // How the slot is erased. Sequential: esp_ota_begin returns at once and each 64 KB block is erased just
    // before it is written (a gap of 46 to 69 ms, #122). It needs the lossless, in-order stream of this path.
    // Switching to the full-size erase (a 4 s wait in otaBegin) is this one line.
    const bool ERASE_SEQUENTIAL = true;

    const uint8_t RESULT_NONE = 0, RESULT_OK = 1, RESULT_ROLLED_BACK = 2;
    const size_t MAX_BASE64 = (Ota::MAX_CHUNK + 2) / 3 * 4;
    const size_t MAX_VERSION = 31;

    State state = State::IDLE;
    const esp_partition_t* target = nullptr;
    esp_ota_handle_t handle = 0;
    uint32_t total = 0;
    uint32_t received = 0;
    char sha[65] = "";
    char version[MAX_VERSION + 1] = "";
    mbedtls_sha256_context hash;
    uint32_t lastActivityMs = 0;
    uint32_t restoreAtMs = 0;       // after UPDATE_FAILED: the ring of the role again (0 = none due)

    int slotIndex(const esp_partition_t* partition) {
        return partition == nullptr ? 0 : partition->subtype - ESP_PARTITION_SUBTYPE_APP_OTA_MIN + 1;
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
    }

    // the update is over with an error: the old firmware keeps running, the ring blinks, then the role shows itself
    void fail(JsonDocument& response, const char* code, const String& message) {
        closeImage();
        state = State::FAILED;
        LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE_FAILED);
        restoreAtMs = millis() + SystemPattern::durationMs(SystemPattern::Id::UPDATE_FAILED, SystemPattern::Args()) + 1;
        ConfigApi::setError(response, code, message);
    }

    bool notReady(JsonDocument& response, const char* what) {
        ConfigApi::setError(response, "not_ready", String(what) + " (update state " + stateName(state) + ")");
        return false;
    }
}

bool Ota::isOp(const char* op) {
    return strcmp(op, "otaBegin") == 0 || strcmp(op, "otaWrite") == 0 || strcmp(op, "otaEnd") == 0
        || strcmp(op, "otaActivate") == 0 || strcmp(op, "otaAbort") == 0;
}

bool Ota::busy() {
    return inProgress(state);
}

void Ota::boot() {
    uint8_t pending = Settings::takeOtaPending();
    if(pending != 0) {
        Settings::setOtaResult(pending == slotIndex(esp_ota_get_running_partition()) ? RESULT_OK : RESULT_ROLLED_BACK);
    }
}

void Ota::service() {
    uint32_t now = millis();
    if(inProgress(state) && expired(now, lastActivityMs)) {
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
    const esp_partition_t* slot = esp_ota_get_next_update_partition(nullptr);
    if(slot == nullptr) {
        ConfigApi::setError(response, "storage", "no slot for an update");
        return;
    }
    if(size > slot->size) {
        ConfigApi::setError(response, "too_large", String("image larger than the slot (") + (uint32_t)slot->size + " bytes)");
        return;
    }

    lastActivityMs = millis();
    restoreAtMs = 0;
    if(!resumes(state, total, sha, size, hex)) {
        reset();
        esp_err_t err = esp_ota_begin(slot, ERASE_SEQUENTIAL ? OTA_WITH_SEQUENTIAL_WRITES : size, &handle);
        if(err != ESP_OK) {
            handle = 0;
            ConfigApi::setError(response, "storage", String("esp_ota_begin: ") + esp_err_to_name(err));
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
    LEDManager::getManager()->setPatternPercent(percent(received, total));
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
    state = State::VERIFYING;
    LEDManager::getManager()->playPattern(SystemPattern::Id::UPDATE_VERIFY);

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
    Settings::setBootRole(role != nullptr && strcmp(role->name(), "central") == 0 ? 1 : 2);   // the role comes back without the button
    Settings::setOtaPending((uint8_t)slotIndex(target));
    response["ok"] = true;
    return true;
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
