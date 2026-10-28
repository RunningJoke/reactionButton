#include "Reports.h"

Reports& Reports::get() {
    static Reports reports;
    return reports;
}

void Reports::beginProgram(const char* program, uint32_t setId, uint32_t nowMs) {
    this->programPath = program;
    this->setIdValue = setId;
    this->logMetrics.clear();
    this->logCount = 0;
    this->logDropped = 0;
    this->cycleCount = 0;
    this->lastReportMs = nowMs;
}

void Reports::log(const char* metric, uint8_t podId, int32_t ms, uint32_t nowMs) {
    int index = -1;
    for(size_t i = 0; i < this->logMetrics.size(); i++) {
        if(this->logMetrics[i].name == metric) {
            index = (int)i;
            break;
        }
    }
    if(index < 0 && this->logMetrics.size() < MAX_METRICS) {
        LogMetric m;
        m.name = metric;
        m.count = 0;
        m.sum = 0;
        m.best = INT32_MAX;
        m.worst = INT32_MIN;
        this->logMetrics.push_back(m);
        index = (int)this->logMetrics.size() - 1;
    }

    // statistics count every value, also those the log has no room for
    if(index >= 0) {
        LogMetric& m = this->logMetrics[index];
        m.count++;
        m.sum += ms;
        if(ms < m.best) m.best = ms;
        if(ms > m.worst) m.worst = ms;
    }

    if(index < 0 || this->logCount >= LOG_SIZE) {
        this->logDropped++;
        return;
    }
    this->logValues[this->logCount++] = Sample{nowMs, (uint8_t)index, podId, ms};
}

const Reports::Report& Reports::build(const std::vector<std::string>& metrics, const std::vector<Var>& vars, uint32_t nowMs) {
    Report report;
    report.id = this->nextId++;
    report.cycle = ++this->cycleCount;
    report.startMs = this->lastReportMs;
    report.endMs = nowMs;
    report.setId = this->setIdValue;
    report.program = this->programPath;
    report.athlete = this->athleteId;
    report.valuesDropped = this->logDropped;
    report.vars = vars;

    // log metric index -> index in the report, -1 = not in the report
    std::vector<int> map(this->logMetrics.size(), -1);
    if(metrics.empty()) {
        for(size_t j = 0; j < this->logMetrics.size(); j++) {
            map[j] = (int)report.metrics.size();
            report.metrics.push_back(this->logMetrics[j].name);
        }
    } else {
        for(const std::string& name : metrics) {
            for(size_t j = 0; j < this->logMetrics.size(); j++) {
                if(this->logMetrics[j].name == name && map[j] < 0) {
                    map[j] = (int)report.metrics.size();
                    report.metrics.push_back(name);
                    break;
                }
            }
        }
    }

    for(uint8_t k = 0; k < this->logCount; k++) {
        const Sample& s = this->logValues[k];
        if(map[s.metric] >= 0) {
            report.values.push_back(Sample{s.t, (uint8_t)map[s.metric], s.pod, s.ms});
        }
    }
    for(size_t j = 0; j < this->logMetrics.size(); j++) {
        const LogMetric& m = this->logMetrics[j];
        if(map[j] >= 0 && m.count > 0) {
            Stat stat;
            stat.metric = (uint8_t)map[j];
            stat.count = m.count;
            stat.average = (int32_t)(m.sum / (int64_t)m.count);
            stat.best = m.best;
            stat.worst = m.worst;
            report.stats.push_back(stat);
        }
    }

    // the log starts over with the next report
    this->logMetrics.clear();
    this->logCount = 0;
    this->logDropped = 0;
    this->lastReportMs = nowMs;

    if(this->buffer.size() >= MAX_REPORTS) {
        this->buffer.erase(this->buffer.begin());
        this->dropped++;
    }
    this->buffer.push_back(std::move(report));
    return this->buffer.back();
}

void Reports::ack(uint32_t reportId) {
    while(!this->buffer.empty() && this->buffer.front().id <= reportId) {
        this->buffer.erase(this->buffer.begin());
    }
}

void Reports::write(const Report& report, JsonObject out) {
    char setId[11];
    snprintf(setId, sizeof(setId), "%08x", (unsigned)report.setId);

    out["id"] = report.id;
    out["program"] = report.program;
    out["setId"] = setId;
    if(!report.athlete.empty()) {
        out["athlete"] = report.athlete;
    }
    out["cycle"] = report.cycle;
    out["startMs"] = report.startMs;
    out["endMs"] = report.endMs;

    JsonArray values = out["values"].to<JsonArray>();
    for(const Sample& s : report.values) {
        JsonObject v = values.add<JsonObject>();
        v["t"] = s.t;
        v["metric"] = report.metrics[s.metric];
        v["pod"] = s.pod;
        v["ms"] = s.ms;
    }

    JsonObject stats = out["stats"].to<JsonObject>();
    for(const Stat& s : report.stats) {
        JsonObject m = stats[report.metrics[s.metric]].to<JsonObject>();
        m["count"] = s.count;
        m["average"] = s.average;
        m["best"] = s.best;
        m["worst"] = s.worst;
    }

    JsonObject vars = out["vars"].to<JsonObject>();
    for(const Var& v : report.vars) {
        vars[v.name] = v.value;
    }
    if(report.valuesDropped > 0) {
        out["valuesDropped"] = report.valuesDropped;
    }
}
