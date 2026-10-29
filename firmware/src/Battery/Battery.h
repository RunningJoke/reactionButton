#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

/**
 * Battery level of the pod (single Li-ion cell, TP4057 charger, GPIO PIN_BATTERY_LEVEL).
 *
 * The cell is divided 1:1 (R6 / R7 = 100 k each, see hardware/pcb), so the pin reads half the
 * cell voltage. The value is the average of BATTERY_SAMPLES readings, refreshed every
 * BATTERY_UPDATE_MS by service(). A pod on USB reads the charge voltage (about 4.2 V, so 100 %).
 *
 * Only a value of 0 mV means "unknown" (no reading yet, or the ADC returned nothing).
 * Thresholds: LOW_PERCENT (amber blink on idle pods, #19), CRITICAL_PERCENT (the central
 * refuses to start a game). Percent: piecewise linear over the table in Battery.cpp.
 */
class Battery {
    public:
        static const uint8_t LOW_PERCENT = 15;
        static const uint8_t CRITICAL_PERCENT = 5;

        // Measures now (16 samples, about a millisecond). Call before the LEDs are lit.
        static void measure();

        // Refreshes the value every BATTERY_UPDATE_MS. Call once per loop pass.
        static void service();

        // Cell voltage in mV, 0 = unknown
        static uint16_t milliVolts() { return mv; }
        static bool known() { return mv != 0; }

        // 0..100 for the cell voltage; 0 for unknown (check known())
        static uint8_t percent() { return percentOf(mv); }
        static uint8_t percentOf(uint16_t cellMv);

        static bool isLow() { return known() && percent() < LOW_PERCENT; }

        // status.battery = {percent, mv}; nothing is written while the level is unknown
        static void describe(JsonObject status);

    private:
        static const uint8_t BATTERY_SAMPLES = 32;
        static const uint32_t BATTERY_UPDATE_MS = 3000;

        static uint16_t sampleMilliVolts();

        static uint16_t mv;
        static uint32_t lastUpdateMs;
};
