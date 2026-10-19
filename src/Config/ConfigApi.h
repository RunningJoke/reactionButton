#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include <string>

/**
 * Request handler of the configuration API, independent of the transport.
 * Used by the USB serial console (SerialConsole) and by BLE (PhoneConfig).
 *
 * A request is one JSON object, e.g. {"op":"status","id":1}. The response is one JSON
 * object with "op", "id" (echoed) and "ok"; errors carry "error" (code) and "message".
 *
 * Common operations: help, status, info, list, get, put, delete, validate, results,
 * trace, reboot, setName, auth, setPin (serial only). With a PIN set, put / delete /
 * setName over BLE need a prior auth on the same connection. Everything else is passed to
 * the active role (IRole::control), e.g. programs, select, start, press on the central.
 * See doc/config-api.md.
 */
class ConfigApi {
    public:
        typedef std::function<void(const std::string&)> Sink;

        // uploadSlot: temp file slot of this transport (uploads of different transports must not mix)
        ConfigApi(const char* transport, uint8_t uploadSlot, Sink sink);

        void handleRequest(const std::string& text);

        // Discards an unfinished upload (e.g. on disconnect)
        void abortUpload();

        // A new client connected: forget the authentication (PIN) and any unfinished upload
        void newSession();

        static void setError(JsonDocument& response, const char* code, const String& message);

        static const size_t MAX_REQUEST = 12288;
        static const size_t MAX_GET_CHUNK = 4096;

    private:
        void send(JsonDocument& response);

        void opHelp(JsonDocument& response);
        void opStatus(JsonDocument& response);
        void opInfo(JsonDocument& response);
        void opList(JsonDocument& response);
        void opGet(JsonObjectConst request, JsonDocument& response);
        void opPut(JsonObjectConst request, JsonDocument& response);
        void opDelete(JsonObjectConst request, JsonDocument& response);
        void opValidate(JsonObjectConst request, JsonDocument& response);
        void opResults(JsonObjectConst request, JsonDocument& response);
        void opTrace(JsonObjectConst request, JsonDocument& response);
        void opReboot(JsonObjectConst request, JsonDocument& response);
        void opSetName(JsonObjectConst request, JsonDocument& response);
        void opAuth(JsonObjectConst request, JsonDocument& response);
        void opSetPin(JsonObjectConst request, JsonDocument& response);

        // true if a write op may run; otherwise sets the auth_required error
        bool checkWriteAccess(JsonDocument& response);
        bool isSerial() const;

        static const uint32_t AUTH_LOCKOUT_MS = 3000;   // after a wrong PIN, all transports
        static uint32_t authLockedUntil;

        const char* transport;
        uint8_t uploadSlot;
        Sink sink;

        bool authenticated = false;
        bool uploadActive = false;
        std::string uploadPath;
        uint32_t uploadOffset = 0;
};
