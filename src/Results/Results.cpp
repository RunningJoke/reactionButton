#include "Results.h"
#include "Config/Console.h"

Results& Results::get() {
    static Results results;
    return results;
}

void Results::record(const char* metric, uint8_t podId, int32_t value) {
    Stats& s = this->metrics[metric];
    s.count++;
    s.sum += value;
    if(value < s.min) s.min = value;
    if(value > s.max) s.max = value;

    Console.printf("RESULT,%lu,%s,%u,%ld\n", (unsigned long)millis(), metric, podId, (long)value);
}

Results::Stats Results::stats(const char* metric) const {
    auto it = this->metrics.find(metric);
    if(it == this->metrics.end()) {
        return Stats();
    }
    return it->second;
}

void Results::reset(const char* metric) {
    this->metrics.erase(metric);
}

void Results::resetAll() {
    this->metrics.clear();
}

void Results::toJson(JsonObject out) const {
    for(const auto& entry : this->metrics) {
        JsonObject m = out[entry.first].to<JsonObject>();
        m["count"] = entry.second.count;
        m["average"] = entry.second.average();
        m["best"] = entry.second.count > 0 ? entry.second.min : 0;
        m["worst"] = entry.second.count > 0 ? entry.second.max : 0;
    }
}
