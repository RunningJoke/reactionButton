#include "Settings.h"
#include <Preferences.h>

static const char* NAMESPACE = "reactpod";
static const char* KEY_SET_ID = "setId";

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

