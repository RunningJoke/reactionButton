#include "ProgramCatalog.h"
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include "Block/JsonUtil.h"

static const char* TAG = "CATALOG";

bool ProgramCatalog::load(const char* indexPath) {
    this->programs.clear();

    File file = SPIFFS.open(indexPath, "r");
    if(!file) {
        ESP_LOGE(TAG, "Missing %s - did you run 'pio run -t uploadfs'?", indexPath);
        return false;
    }

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, file);
    file.close();
    if(error) {
        ESP_LOGE(TAG, "%s: %s", indexPath, error.c_str());
        return false;
    }

    for(JsonVariantConst entry : doc["programs"].as<JsonArrayConst>()) {
        ProgramInfo info;
        if(!JsonUtil::getString(entry, info.path)) {
            ESP_LOGE(TAG, "%s: program entries must be file paths", indexPath);
            continue;
        }
        if(this->loadInfo(info.path.c_str(), info)) {
            this->programs.push_back(info);
        }
    }

    ESP_LOGI(TAG, "%u programs available", (unsigned)this->programs.size());
    return !this->programs.empty();
}

bool ProgramCatalog::loadInfo(const char* path, ProgramInfo& info) {
    File file = SPIFFS.open(path, "r");
    if(!file) {
        ESP_LOGE(TAG, "Missing program file %s", path);
        return false;
    }

    // only parse the metadata, not the blocks
    JsonDocument filter;
    filter["name"] = true;
    filter["peripherals"] = true;
    filter["menu"] = true;

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, file, DeserializationOption::Filter(filter));
    file.close();
    if(error) {
        ESP_LOGE(TAG, "%s: %s", path, error.c_str());
        return false;
    }

    info.name = doc["name"] | path;
    info.peripherals = doc["peripherals"] | 0;

    for(JsonObjectConst group : doc["menu"].as<JsonArrayConst>()) {
        ColorSet color;
        if(!JsonUtil::parseColor(group["color"], color)) {
            ESP_LOGW(TAG, "%s: invalid menu colour", path);
            continue;
        }
        for(JsonVariantConst led : group["leds"].as<JsonArrayConst>()) {
            info.menuLeds.push_back(MenuLed{led.as<uint8_t>(), color});
        }
    }
    return true;
}

void ProgramCatalog::showMenu(size_t index, LEDManager& leds) const {
    leds.turnOff();
    if(index >= this->programs.size()) {
        return;
    }
    for(const MenuLed& led : this->programs[index].menuLeds) {
        ColorSet color = led.color;
        leds.setLEDColors(led.index, &color);
    }
}
