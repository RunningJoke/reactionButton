#include "Settings.h"
#include <Preferences.h>

static const char* NAMESPACE = "reactpod";
static const char* KEY_SET_ID = "setId";
static const char* KEY_STORE_GEN = "storeGen";
static const char* KEY_SEEN_GEN = "seenGen";
static const char* KEY_STORE_HASH = "storeHash";

uint32_t Settings::getSetId() {
    Preferences prefs;
    prefs.begin(NAMESPACE, true);
    uint32_t setId = prefs.getUInt(KEY_SET_ID, 0);
    prefs.end();
    return setId;
}

void Settings::setSetId(uint32_t setId) {
    Preferences prefs;
    prefs.begin(NAMESPACE, false);
    prefs.putUInt(KEY_SET_ID, setId);
    prefs.end();
}

uint32_t Settings::getOrCreateSetId() {
    uint32_t setId = Settings::getSetId();
    if(setId == 0) {
        do {
            setId = esp_random();
        } while(setId == 0);
        Settings::setSetId(setId);
        ESP_LOGI("SETTINGS", "created new set id %08x", setId);
    }
    return setId;
}

uint32_t Settings::getStoreGeneration() {
    Preferences prefs;
    prefs.begin(NAMESPACE, true);
    uint32_t generation = prefs.getUInt(KEY_STORE_GEN, 0);
    prefs.end();
    return generation;
}

void Settings::setStoreGeneration(uint32_t generation) {
    Preferences prefs;
    prefs.begin(NAMESPACE, false);
    prefs.putUInt(KEY_STORE_GEN, generation);
    prefs.end();
}

uint32_t Settings::getSeenGeneration() {
    Preferences prefs;
    prefs.begin(NAMESPACE, true);
    uint32_t generation = prefs.getUInt(KEY_SEEN_GEN, 0);
    prefs.end();
    return generation;
}

void Settings::setSeenGeneration(uint32_t generation) {
    Preferences prefs;
    prefs.begin(NAMESPACE, false);
    prefs.putUInt(KEY_SEEN_GEN, generation);
    prefs.end();
}

uint32_t Settings::getStoreHash() {
    Preferences prefs;
    prefs.begin(NAMESPACE, true);
    uint32_t hash = prefs.getUInt(KEY_STORE_HASH, 0);
    prefs.end();
    return hash;
}

void Settings::setStoreHash(uint32_t hash) {
    Preferences prefs;
    prefs.begin(NAMESPACE, false);
    prefs.putUInt(KEY_STORE_HASH, hash);
    prefs.end();
}
