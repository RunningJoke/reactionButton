#include "SerialConsole.h"
#include "Config/Console.h"

// temp file slot for serial uploads (BLE uses 0, sync 1 ..)
static const uint8_t SERIAL_UPLOAD_SLOT = 250;

static void writeLine(const std::string& text) {
    // one write per line keeps it together as far as possible when logs interleave
    std::string out = text;
    out += '\n';
    Console.write((const uint8_t*)out.data(), out.size());
}

SerialConsole& SerialConsole::get() {
    static SerialConsole console;
    return console;
}

SerialConsole::SerialConsole() : api("serial", SERIAL_UPLOAD_SLOT, writeLine) {}

void SerialConsole::emit(JsonDocument& event) {
    std::string out;
    serializeJson(event, out);
    writeLine(out);
}

void SerialConsole::service() {
    while(Console.available() > 0) {
        int c = Console.read();
        if(c < 0) {
            break;
        }
        if(c == '\n' || c == '\r') {
            if(!this->discarding && !this->line.empty()) {
                this->handleLine(this->line);
            }
            this->line.clear();
            this->discarding = false;
            continue;
        }
        if(this->discarding) {
            continue;
        }
        if(this->line.size() >= ConfigApi::MAX_REQUEST) {
            this->line.clear();
            this->discarding = true;
            JsonDocument response;
            ConfigApi::setError(response, "too_large", "request too long");
            SerialConsole::emit(response);
            continue;
        }
        this->line += (char)c;
    }
}

void SerialConsole::handleLine(const std::string& text) {
    size_t start = text.find_first_not_of(" \t");
    if(start == std::string::npos) {
        return;
    }
    if(text[start] == '{') {
        this->api.handleRequest(text.substr(start));
    } else {
        this->api.handleRequest(SerialConsole::textToJson(text.substr(start)));
    }
}

// "select 2" -> {"op":"select","program":2}; the field name of the argument depends on the op
std::string SerialConsole::textToJson(const std::string& text) {
    size_t space = text.find(' ');
    std::string op = text.substr(0, space);
    std::string arg;
    if(space != std::string::npos) {
        size_t argStart = text.find_first_not_of(' ', space);
        if(argStart != std::string::npos) {
            arg = text.substr(argStart);
            while(!arg.empty() && arg.back() == ' ') arg.pop_back();
        }
    }

    JsonDocument doc;
    doc["op"] = op;
    if(!arg.empty()) {
        const char* field = "arg";
        if(op == "get" || op == "delete" || op == "validate") field = "path";
        else if(op == "select") field = "program";
        else if(op == "reboot") field = "role";
        else if(op == "trace") field = "on";
        else if(op == "setName") field = "name";

        bool numeric = arg.find_first_not_of("0123456789") == std::string::npos;
        if(op == "setName") {
            doc[field] = arg;   // always text, also "2"
        } else if(op == "trace") {
            doc[field] = (arg == "on" || arg == "1" || arg == "true");
        } else if(numeric) {
            doc[field] = atol(arg.c_str());
        } else {
            doc[field] = arg;
        }
    }
    std::string out;
    serializeJson(doc, out);
    return out;
}
