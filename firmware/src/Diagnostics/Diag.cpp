#include "Diag.h"
#include <esp_system.h>
#include <esp_attr.h>

static const uint32_t MAGIC = 0x52504447;   // "RPDG"

RTC_NOINIT_ATTR static uint32_t rtcMagic;
RTC_NOINIT_ATTR static char rtcStep[40];

static esp_reset_reason_t previousReason = ESP_RST_UNKNOWN;
static char previousStep[40] = "";

static const char* reasonName(esp_reset_reason_t reason) {
    switch(reason) {
        case ESP_RST_POWERON: return "power-on";
        case ESP_RST_EXT: return "external";
        case ESP_RST_SW: return "software";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "interrupt-watchdog";
        case ESP_RST_TASK_WDT: return "task-watchdog";
        case ESP_RST_WDT: return "watchdog";
        case ESP_RST_DEEPSLEEP: return "deep-sleep";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "sdio";
        default: return "unknown";
    }
}

void Diag::step(const char* name) {
    rtcMagic = MAGIC;
    strncpy(rtcStep, name, sizeof(rtcStep) - 1);
    rtcStep[sizeof(rtcStep) - 1] = '\0';
}

void Diag::begin() {
    previousReason = esp_reset_reason();
    if(rtcMagic == MAGIC) {
        memcpy(previousStep, rtcStep, sizeof(previousStep));
        previousStep[sizeof(previousStep) - 1] = '\0';
    }
    Diag::step("boot");
}

bool Diag::lastResetWasAbnormal() {
    return previousReason == ESP_RST_PANIC || previousReason == ESP_RST_INT_WDT
        || previousReason == ESP_RST_TASK_WDT || previousReason == ESP_RST_WDT
        || previousReason == ESP_RST_BROWNOUT;
}

void Diag::describe(JsonObject out) {
    out["reason"] = reasonName(previousReason);
    out["lastStep"] = previousStep;
}
