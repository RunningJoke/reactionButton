#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include "Config/ConfigApi.h"

/**
 * Configuration API on the USB serial port (115200 baud, any line ending).
 *
 * Input, one command per line:
 *   JSON:  {"op":"select","program":"/prog/duo.json","id":7}
 *   text:  select /prog/duo.json      (first word = op, rest = its main argument)
 *
 * Output: every response and every event is one JSON line starting with '{'.
 * Log output of the firmware is mixed in; it never starts with '{'.
 *   response: {"op":"select","id":7,"ok":true,...}
 *   event:    {"event":"state","state":"CONFIRM",...}
 */
class SerialConsole {
    public:
        static SerialConsole& get();

        // Reads and handles input. Call once per loop pass.
        void service();

        // Prints an event line ({"event": ...})
        static void emit(JsonDocument& event);

    private:
        SerialConsole();
        void handleLine(const std::string& line);
        static std::string textToJson(const std::string& line);

        ConfigApi api;
        std::string line;
        bool discarding = false;
};
