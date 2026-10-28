#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include <vector>

/**
 * Measurement log and report buffer of the central (programs.md §7.16).
 *
 * Every measurement (Results::record, timerStop) is also logged here until the next report.
 * A `communicate` block turns the log into a Report, which is kept in a buffer of
 * MAX_REPORTS (RAM only) until the client acknowledges it, and sent as a `report` event.
 *
 * Reports are stored as plain structs (metric names once per report, values as numbers),
 * and rendered to JSON only when they are sent or read back.
 */
class Reports {
    public:
        static const uint8_t LOG_SIZE = 48;         // values kept per report period
        static const uint8_t MAX_METRICS = 16;      // different metric names per report period
        static const uint8_t MAX_REPORTS = 8;
        static const size_t MAX_NAME = 32;          // metric and variable names
        static const size_t MAX_ATHLETE = 40;       // bytes

        struct Sample {
            uint32_t t;         // millis() when recorded
            uint8_t metric;     // index into Report::metrics
            uint8_t pod;
            int32_t ms;
        };

        struct Stat {
            uint8_t metric;     // index into Report::metrics
            uint32_t count;
            int32_t average;    // truncated
            int32_t best;       // smallest
            int32_t worst;      // largest
        };

        struct Var {
            std::string name;
            int64_t value;
        };

        struct Report {
            uint32_t id;
            uint32_t cycle;
            uint32_t startMs;
            uint32_t endMs;
            uint32_t setId;
            uint32_t valuesDropped;     // values of the period that did not fit into the log
            std::string program;
            std::string athlete;        // "" if no session set one
            std::vector<std::string> metrics;
            std::vector<Sample> values;
            std::vector<Stat> stats;
            std::vector<Var> vars;
        };

        static Reports& get();

        // Program start: clears the log, the cycle counter starts again
        void beginProgram(const char* program, uint32_t setId, uint32_t nowMs);

        // Every measurement of the central
        void log(const char* metric, uint8_t podId, int32_t ms, uint32_t nowMs);

        // Builds a report of the log (metrics empty = all metrics), clears the log and puts the
        // report into the buffer. The oldest report is dropped when the buffer is full.
        // Returns the new report.
        const Report& build(const std::vector<std::string>& metrics, const std::vector<Var>& vars, uint32_t nowMs);

        // Removes the report and all older ones from the buffer
        void ack(uint32_t reportId);

        // Session: athlete id copied into every following report (RAM, lost on reboot)
        void setAthlete(const std::string& athlete) { this->athleteId = athlete; }
        const std::string& athlete() const { return this->athleteId; }

        size_t pending() const { return this->buffer.size(); }
        uint32_t droppedReports() const { return this->dropped; }
        const std::vector<Report>& reports() const { return this->buffer; }

        // Writes the fields of a report (id, program, ..., vars, valuesDropped) into out
        static void write(const Report& report, JsonObject out);

    private:
        struct LogMetric {
            std::string name;
            uint32_t count;
            int64_t sum;
            int32_t best;
            int32_t worst;
        };

        Reports() {}

        // Log of the current report period
        std::vector<LogMetric> logMetrics;
        Sample logValues[LOG_SIZE];
        uint8_t logCount = 0;
        uint32_t logDropped = 0;

        std::string programPath;
        uint32_t setIdValue = 0;
        uint32_t cycleCount = 0;
        uint32_t lastReportMs = 0;
        uint32_t nextId = 1;
        uint32_t dropped = 0;
        std::string athleteId;
        std::vector<Report> buffer;
};
