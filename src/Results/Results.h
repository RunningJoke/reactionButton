#pragma once

#include <Arduino.h>
#include <map>
#include <string>
#include <ArduinoJson.h>

/**
 * Collects measurements produced by blocks (reaction times, later other metrics).
 *
 * Every record is printed as one CSV line on the serial console:
 *   RESULT,<millis>,<metric>,<podId>,<value>
 * and added to running statistics per metric name, which a "summary" block can print
 * and copy into variables.
 */
class Results {
    public:
        struct Stats {
            uint32_t count = 0;
            int64_t sum = 0;
            int32_t min = INT32_MAX;
            int32_t max = INT32_MIN;

            int32_t average() const { return this->count > 0 ? (int32_t)(this->sum / this->count) : 0; }
        };

        static Results& get();

        void record(const char* metric, uint8_t podId, int32_t value);

        // Returns empty stats if the metric was never recorded
        Stats stats(const char* metric) const;

        // {"<metric>": {"count", "average", "best", "worst"}, ...}
        void toJson(JsonObject out) const;

        void reset(const char* metric);
        void resetAll();

    private:
        Results() {}
        std::map<std::string, Stats> metrics;
};
