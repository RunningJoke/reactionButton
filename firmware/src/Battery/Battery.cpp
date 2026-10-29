#include "Battery.h"
#include "_Definitions.h"

uint16_t Battery::mv = 0;
uint32_t Battery::lastUpdateMs = 0;

// Cell voltage (mV) -> percent, piecewise linear. Below the first entry 0 %, above the last 100 %.
static const struct {
    uint16_t mv;
    uint8_t percent;
} CURVE[] = {
    {3300, 0},
    {3400, 3},
    {3500, 7},
    {3600, 15},
    {3700, 30},
    {3800, 45},
    {3900, 60},
    {4000, 75},
    {4100, 90},
    {4200, 100},
};

uint8_t Battery::percentOf(uint16_t cellMv)
{
    const size_t n = sizeof(CURVE) / sizeof(CURVE[0]);
    if(cellMv <= CURVE[0].mv) {
        return CURVE[0].percent;
    }
    if(cellMv >= CURVE[n - 1].mv) {
        return CURVE[n - 1].percent;
    }
    for(size_t i = 1; i < n; i++) {
        if(cellMv <= CURVE[i].mv) {
            uint16_t span = CURVE[i].mv - CURVE[i-1].mv;
            uint16_t above = cellMv - CURVE[i-1].mv;
            return (uint8_t)(CURVE[i-1].percent + (CURVE[i].percent - CURVE[i-1].percent) * above / span);
        }
    }
    return 100;
}

// The pin reads half the cell voltage (divider 100 k / 100 k). analogReadMilliVolts is calibrated.
// GPIO 5 is ADC2: ESP-IDF 4.4 refuses ADC2 on the C3 (errata) unless CONFIG_ADC_ONESHOT_FORCE_USE_ADC2_ON_C3
// is set (sdkconfig.NewBoard). A failed conversion returns 0 (ADC2 can be busy with the radio): such samples
// do not count.
uint16_t Battery::sampleMilliVolts()
{
    uint32_t sum = 0;
    uint8_t valid = 0;
    for(uint8_t i = 0; i < BATTERY_SAMPLES; i++) {
        uint32_t pinMv = analogReadMilliVolts(PIN_BATTERY_LEVEL);
        if(pinMv != 0) {
            sum += pinMv;
            valid++;
        }
    }
    return valid == 0 ? 0 : (uint16_t)(sum / valid * 2);
}

void Battery::measure()
{
    lastUpdateMs = millis();
    uint16_t cell = sampleMilliVolts();
    if(cell != 0) {
        // single readings scatter by about ±150 mV (ADC2, charger ripple): smooth over the updates.
        // A failed read keeps the last value.
        mv = mv == 0 ? cell : (uint16_t)((mv * 3u + cell) / 4u);
    }
}

void Battery::service()
{
    if(millis() - lastUpdateMs >= BATTERY_UPDATE_MS) {
        measure();
    }
}

void Battery::describe(JsonObject status)
{
    if(!known()) {
        return;
    }
    JsonObject b = status["battery"].to<JsonObject>();
    b["percent"] = percent();
    b["mv"] = mv;
}
