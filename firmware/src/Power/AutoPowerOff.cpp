#include "AutoPowerOff.h"
#include <esp_sleep.h>
#include "_Definitions.h"
#include "Config/Console.h"
#include "Config/SerialConsole.h"
#include "Diagnostics/Diag.h"
#include "Input/Button.h"
#include "LEDManager/LEDManager.h"

namespace {
    const uint32_t IDLE_LIMIT_MS = AUTO_POWER_OFF_MINUTES * 60UL * 1000UL;

    uint32_t lastActivityMs = 0;
    uint32_t lastActivityNoUsbMs = 0;   // the same without the USB rule, for status (tests over USB)
    uint32_t lastPressCount = 0;

    // Shows the goodbye (SystemPattern::SLEEP: white drains, the LEDs dim to off) and enters deep sleep.
    // Does not return. The pattern is driven here, because the loop does not run during the sleep sequence.
    void sleepNow() {
        JsonDocument event;
        event["event"] = "sleep";
        event["idleMinutes"] = AUTO_POWER_OFF_MINUTES;
        SerialConsole::emit(event);
        Console.println("Auto power-off: goodbye, sleeping until the button is pressed");
        Console.flush();

        LEDManager* leds = LEDManager::getManager();
        leds->playPattern(SystemPattern::Id::SLEEP);
        int64_t end = esp_timer_get_time() + (int64_t)SystemPattern::SLEEP_MS * 1000;
        while(esp_timer_get_time() < end) {
            leds->service();
            delay(1);
        }
        leds->service();        // the end frame (dark)
        leds->turnOff();

        Diag::step("sleep");
        Console.flush();
        // ESP32-C3: GPIO 3 is an RTC pin, the button pulls it LOW. Wake = normal boot.
        esp_deep_sleep_enable_gpio_wakeup(BIT(PIN_BUTTON_PRESS), ESP_GPIO_WAKEUP_GPIO_LOW);
        esp_deep_sleep_start();
    }
}

void AutoPowerOff::service(bool allowed) {
    Button& button = Button::get();
    uint32_t now = millis();

    // a press (or a press in progress), any state that must stay awake and a USB host (a computer:
    // configuration, tests; a plain charger is no host) restart the idle time
    bool active = !allowed || button.isDown() || button.pressCount() != lastPressCount;
    lastPressCount = button.pressCount();
    if(active) {
        lastActivityNoUsbMs = now;
    }
    if(active || HWCDC::isPlugged()) {
        lastActivityMs = now;
        return;
    }
    if(now - lastActivityMs >= IDLE_LIMIT_MS) {
        sleepNow();
    }
}

void AutoPowerOff::describe(JsonObject status) {
    JsonObject p = status["powerOff"].to<JsonObject>();
    uint32_t now = millis();
    p["idleMs"] = now - lastActivityNoUsbMs;       // as if no USB host were connected
    p["limitMs"] = IDLE_LIMIT_MS;
    p["usbHost"] = HWCDC::isPlugged();
}
