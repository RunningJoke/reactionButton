#include "ConfigApi.h"
#include "Config/Console.h"
#include <SPIFFS.h>
#include "_Definitions.h"
#include "Config/SerialConsole.h"
#include "Link/Protocol.h"
#include "Store/ProgramStore.h"
#include "Settings/Settings.h"
#include "BlockManager/BlockManager.h"
#include "Block/BlockFactory/BlockFactory.h"
#include "Results/Results.h"
#include "Roles/RoleManager.h"
#include "Diagnostics/Diag.h"

static const char* TAG = "CONFIGAPI";

namespace {
    String hex32(uint32_t value) {
        char buffer[11];
        snprintf(buffer, sizeof(buffer), "%08x", (unsigned)value);
        return String(buffer);
    }

    // accepts a number or a hex string ("1a2b3c4d" / "0x1a2b3c4d")
    bool parseCrc(JsonVariantConst json, uint32_t& crc) {
        if(json.is<uint32_t>()) {
            crc = json.as<uint32_t>();
            return true;
        }
        if(json.is<const char*>()) {
            char* end = nullptr;
            crc = strtoul(json.as<const char*>(), &end, 16);
            return end != json.as<const char*>() && *end == '\0';
        }
        return false;
    }

    const char* BAD_PATH_MESSAGE = "path must be /programs.json or /prog/... (max 31 characters)";

    void traceBlockEnter(const char* blockName) {
        JsonDocument event;
        event["event"] = "block";
        event["name"] = blockName;
        event["t"] = millis();
        SerialConsole::emit(event);
    }
}

uint32_t ConfigApi::authLockedUntil = 0;

ConfigApi::ConfigApi(const char* transport, uint8_t uploadSlot, Sink sink)
    : transport(transport), uploadSlot(uploadSlot), sink(sink) {}

void ConfigApi::setError(JsonDocument& response, const char* code, const String& message) {
    response["ok"] = false;
    response["error"] = code;
    response["message"] = message;
    ESP_LOGW(TAG, "%s: %s", code, message.c_str());
}

void ConfigApi::send(JsonDocument& response) {
    std::string out;
    serializeJson(response, out);
    this->sink(out);
}

void ConfigApi::abortUpload() {
    this->uploadActive = false;
}

void ConfigApi::newSession() {
    this->authenticated = false;
    this->abortUpload();
}

bool ConfigApi::isSerial() const {
    return strcmp(this->transport, "serial") == 0;
}

bool ConfigApi::checkWriteAccess(JsonDocument& response) {
    // USB serial needs physical access, like clearing the PIN: no PIN needed there
    if(this->authenticated || this->isSerial() || Settings::getPin().isEmpty()) {
        return true;
    }
    setError(response, "auth_required", "a PIN is set: send {\"op\":\"auth\",\"pin\":\"...\"} first");
    return false;
}

void ConfigApi::handleRequest(const std::string& text) {
    JsonDocument request;
    JsonDocument response;

    DeserializationError error = deserializeJson(request, text);
    if(error || !request.is<JsonObject>()) {
        setError(response, "bad_request", String("invalid JSON: ") + (error ? error.c_str() : "not an object"));
        this->send(response);
        return;
    }

    const char* op = request["op"] | "";
    response["op"] = op;
    if(!request["id"].isNull()) {
        response["id"] = request["id"];
    }

    JsonObjectConst req = request.as<JsonObjectConst>();
    IRole* role = RoleManager::getManager()->current();

    if(strcmp(op, "help") == 0) this->opHelp(response);
    else if(strcmp(op, "status") == 0) this->opStatus(response);
    else if(strcmp(op, "info") == 0) this->opInfo(response);
    else if(strcmp(op, "list") == 0) this->opList(response);
    else if(strcmp(op, "get") == 0) this->opGet(req, response);
    else if(strcmp(op, "put") == 0) this->opPut(req, response);
    else if(strcmp(op, "delete") == 0) this->opDelete(req, response);
    else if(strcmp(op, "validate") == 0) this->opValidate(req, response);
    else if(strcmp(op, "results") == 0) this->opResults(req, response);
    else if(strcmp(op, "trace") == 0) this->opTrace(req, response);
    else if(strcmp(op, "setName") == 0) this->opSetName(req, response);
    else if(strcmp(op, "auth") == 0) this->opAuth(req, response);
    else if(strcmp(op, "setPin") == 0) this->opSetPin(req, response);
    else if(strcmp(op, "reboot") == 0) {
        this->opReboot(req, response);
        return;     // response already sent, the pod restarts
    }
    else if(role == nullptr || !role->control(op, req, response)) {
        setError(response, "bad_request", String("unknown op '") + op + "' (try 'help')");
    }
    this->send(response);
}

// ---------------------------------------------------------------- general

void ConfigApi::opHelp(JsonDocument& response) {
    response["ok"] = true;
    JsonArray ops = response["ops"].to<JsonArray>();
    const char* common[] = {"help", "status", "info", "list", "get", "put", "delete", "validate",
                            "results", "trace", "reboot", "setName", "auth"};
    for(const char* op : common) ops.add(op);
    if(this->isSerial()) {
        ops.add("setPin");
    }
    IRole* role = RoleManager::getManager()->current();
    if(role != nullptr && strcmp(role->name(), "central") == 0) {
        const char* central[] = {"programs", "select", "start", "press", "effect", "stop"};
        for(const char* op : central) ops.add(op);
    } else {
        ops.add("press");
        ops.add("effect");
    }
    response["transport"] = this->transport;
}

void ConfigApi::opStatus(JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    IRole* role = RoleManager::getManager()->current();

    response["ok"] = true;
    response["role"] = role != nullptr ? role->name() : "booting";
    response["firmware"] = String(FW_VERSION_MAJOR) + "." + String(FW_VERSION_MINOR);
    response["uptimeMs"] = millis();
    response["setId"] = hex32(Settings::getSetId());
    if(this->mtuSource) {
        response["mtu"] = this->mtuSource();
    }
    JsonObject st = response["store"].to<JsonObject>();
    st["generation"] = store.generation();
    st["hash"] = hex32(store.hash());
    Diag::describe(response["lastReset"].to<JsonObject>());
    if(role != nullptr) {
        role->describe(response.as<JsonObject>());
    }
}

void ConfigApi::opInfo(JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    response["ok"] = true;
    response["firmware"] = String(FW_VERSION_MAJOR) + "." + String(FW_VERSION_MINOR);
    response["linkProtocol"] = (uint32_t)Protocol::VERSION;
    response["setId"] = hex32(Settings::getSetId());
    response["setName"] = Settings::getSetName();
    response["pinRequired"] = !Settings::getPin().isEmpty() && !this->isSerial();
    response["generation"] = store.generation();
    response["storeHash"] = hex32(store.hash());
    response["freeBytes"] = store.freeBytes();
    response["maxFileSize"] = (uint32_t)ProgramStore::MAX_FILE_SIZE;
    response["maxPathLength"] = (uint32_t)ProgramStore::MAX_PATH;
    response["maxRequest"] = (uint32_t)MAX_REQUEST;
    response["maxGetChunk"] = (uint32_t)MAX_GET_CHUNK;
    response["transport"] = this->transport;
    if(this->mtuSource) {
        response["mtu"] = this->mtuSource();
    }
    response["programFormat"] = (uint32_t)BlockFactory::PROGRAM_FORMAT;
    JsonArray features = response["features"].to<JsonArray>();
    features.add("validateInline");
    features.add("listMeta");
    features.add("effects");
    JsonArray types = response["blockTypes"].to<JsonArray>();
    for(size_t i = 0; BlockFactory::typeName(i) != nullptr; i++) {
        types.add(BlockFactory::typeName(i));
    }
}

void ConfigApi::opResults(JsonObjectConst request, JsonDocument& response) {
    response["ok"] = true;
    Results::get().toJson(response["metrics"].to<JsonObject>());
    if(request["reset"] | false) {
        Results::get().resetAll();
    }
}

void ConfigApi::opTrace(JsonObjectConst request, JsonDocument& response) {
    bool on = request["on"] | true;
    BlockManager::getManager()->setEnterHook(on ? &traceBlockEnter : nullptr);
    response["ok"] = true;
    response["trace"] = on;
}

void ConfigApi::opReboot(JsonObjectConst request, JsonDocument& response) {
    const char* role = request["role"] | "auto";
    uint8_t bootRole = 0;
    if(strcmp(role, "central") == 0) bootRole = 1;
    else if(strcmp(role, "peripheral") == 0) bootRole = 2;
    else if(strcmp(role, "auto") != 0) {
        setError(response, "bad_request", "role must be central, peripheral or auto");
        this->send(response);
        return;
    }
    Settings::setBootRole(bootRole);
    response["ok"] = true;
    response["role"] = role;
    this->send(response);
    Console.flush();
    delay(200);
    esp_restart();
}

void ConfigApi::opSetName(JsonObjectConst request, JsonDocument& response) {
    if(!this->checkWriteAccess(response)) {
        return;
    }
    JsonVariantConst value = request["name"];
    if(!value.isNull() && !value.is<const char*>()) {
        setError(response, "bad_request", "'name' must be a string");
        return;
    }
    String name = value | "";
    name.trim();
    if(name.length() > Settings::MAX_SET_NAME) {
        setError(response, "bad_request", "name longer than " + String((uint32_t)Settings::MAX_SET_NAME) + " bytes");
        return;
    }
    for(size_t i = 0; i < name.length(); i++) {
        if((uint8_t)name[i] < 0x20 || name[i] == 0x7F) {
            setError(response, "bad_request", "name contains control characters");
            return;
        }
    }
    Settings::setSetName(name);
    response["ok"] = true;
    response["setName"] = name;
}

void ConfigApi::opAuth(JsonObjectConst request, JsonDocument& response) {
    String pin = Settings::getPin();
    if(pin.isEmpty()) {
        this->authenticated = true;     // nothing to check
        response["ok"] = true;
        return;
    }
    if(authLockedUntil != 0 && (int32_t)(millis() - authLockedUntil) < 0) {
        setError(response, "auth_failed", "too many attempts, wait " + String(AUTH_LOCKOUT_MS / 1000) + " s");
        return;
    }
    const char* given = request["pin"];
    if(given == nullptr || pin != given) {
        this->authenticated = false;
        authLockedUntil = millis() + AUTH_LOCKOUT_MS;   // slows down guessing
        setError(response, "auth_failed", "wrong PIN");
        return;
    }
    this->authenticated = true;
    response["ok"] = true;
}

void ConfigApi::opSetPin(JsonObjectConst request, JsonDocument& response) {
    if(!this->isSerial()) {
        setError(response, "bad_request", "the PIN can only be set or cleared over USB serial");
        return;
    }
    JsonVariantConst value = request["pin"];
    if(!value.isNull() && !value.is<const char*>()) {
        setError(response, "bad_request", "'pin' must be a string of 4-6 digits");
        return;
    }
    String pin = value | "";
    bool digits = true;
    for(size_t i = 0; i < pin.length(); i++) {
        digits = digits && isdigit((unsigned char)pin[i]);
    }
    if(!pin.isEmpty() && (pin.length() < 4 || pin.length() > 6 || !digits)) {
        setError(response, "bad_request", "'pin' must be 4-6 digits (\"\" clears it)");
        return;
    }
    Settings::setPin(pin);
    response["ok"] = true;
    response["pinSet"] = !pin.isEmpty();
}

// ---------------------------------------------------------------- program files

void ConfigApi::opList(JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    response["ok"] = true;
    response["generation"] = store.generation();
    response["storeHash"] = hex32(store.hash());

    JsonArray files = response["files"].to<JsonArray>();
    std::vector<ProgramStore::FileInfo> listed = store.list();
    store.pruneMeta(listed);
    for(const ProgramStore::FileInfo& f : listed) {
        JsonObject entry = files.add<JsonObject>();
        entry["path"] = f.path;
        entry["size"] = f.size;
        entry["crc"] = hex32(f.crc);
        if(f.path == "/programs.json") {
            continue;   // the menu, neither program nor fragment
        }
        // program metadata, cached by CRC: files are only parsed again after a change
        const ProgramStore::ProgramMeta& meta = store.programMeta(f);
        if(meta.program) {
            entry["name"] = meta.name;
            if(!meta.peripherals.empty()) entry["peripherals"] = serialized(meta.peripherals);
            if(!meta.menu.empty()) entry["menu"] = serialized(meta.menu);
        } else if(meta.parsed) {
            entry["fragment"] = true;
        }
    }

    // the menu order as configured in /programs.json
    JsonArray menu = response["menu"].to<JsonArray>();
    File index = SPIFFS.open("/programs.json", "r");
    if(index) {
        JsonDocument doc;
        if(!deserializeJson(doc, index)) {
            for(JsonVariantConst entry : doc["programs"].as<JsonArrayConst>()) {
                menu.add(entry);
            }
        }
        index.close();
    }
}

void ConfigApi::opGet(JsonObjectConst request, JsonDocument& response) {
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        setError(response, "bad_path", BAD_PATH_MESSAGE);
        return;
    }
    uint32_t offset = request["offset"] | 0;
    size_t length = request["length"] | 2048;
    if(length == 0 || length > MAX_GET_CHUNK) {
        length = MAX_GET_CHUNK;
    }

    std::string data(length, '\0');
    size_t n = 0;
    uint32_t total = 0;
    if(!ProgramStore::get().read(path, offset, (uint8_t*)&data[0], length, n, total)) {
        if(ProgramStore::get().exists(path)) {
            setError(response, "bad_offset", "offset beyond end of file");
        } else {
            setError(response, "not_found", String(path) + " does not exist");
        }
        return;
    }
    // never split a UTF-8 character between two chunks
    if(offset + n < total) {
        while(n > 0 && ((uint8_t)data[n] & 0xC0) == 0x80) {
            n--;
        }
    }
    data.resize(n);

    ProgramStore::FileInfo info;
    ProgramStore::get().fileInfo(path, info);

    response["ok"] = true;
    response["path"] = path;
    response["offset"] = offset;
    response["size"] = total;
    response["crc"] = hex32(info.crc);
    response["eof"] = offset + n >= total;
    response["data"] = data;
}

void ConfigApi::opPut(JsonObjectConst request, JsonDocument& response) {
    if(!this->checkWriteAccess(response)) {
        return;
    }
    ProgramStore& store = ProgramStore::get();
    IRole* role = RoleManager::getManager()->current();
    if(role != nullptr && !role->storeEditable()) {
        setError(response, "busy", "program files cannot be changed now (game or sync running)");
        return;
    }
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        setError(response, "bad_path", BAD_PATH_MESSAGE);
        return;
    }
    if(!request["data"].is<const char*>()) {
        setError(response, "bad_request", "'data' (string) missing");
        return;
    }
    const char* data = request["data"];
    size_t len = strlen(data);
    uint32_t offset = request["offset"] | 0;
    bool final = request["final"] | true;

    if(offset == 0) {
        this->uploadActive = true;
        this->uploadPath = path;
        this->uploadOffset = 0;
    } else if(!this->uploadActive || this->uploadPath != path || offset != this->uploadOffset) {
        setError(response, "bad_offset", "expected offset " + String(this->uploadOffset) + " for " + this->uploadPath.c_str());
        return;
    }
    if(offset + len > ProgramStore::MAX_FILE_SIZE) {
        this->uploadActive = false;
        setError(response, "too_large", "file larger than " + String((uint32_t)ProgramStore::MAX_FILE_SIZE) + " bytes");
        return;
    }
    if(!store.writeTemp(this->uploadSlot, offset, (const uint8_t*)data, len)) {
        this->uploadActive = false;
        setError(response, "storage", "could not write to flash (full?)");
        return;
    }
    this->uploadOffset = offset + len;

    if(!final) {
        response["ok"] = true;
        response["path"] = path;
        response["received"] = this->uploadOffset;
        return;
    }

    // final chunk: check and commit
    this->uploadActive = false;
    uint32_t size = 0;
    uint32_t crc = 0;
    store.tempInfo(this->uploadSlot, size, crc);

    uint32_t expectedCrc;
    if(!request["crc"].isNull() && (!parseCrc(request["crc"], expectedCrc) || expectedCrc != crc)) {
        setError(response, "crc_mismatch", "received data has CRC " + hex32(crc));
        return;
    }
    String jsonError;
    if(!store.tempIsValidJson(this->uploadSlot, jsonError)) {
        setError(response, "invalid_json", jsonError);
        return;
    }

    ProgramStore::Commit commit;
    commit.files.push_back(std::make_pair(this->uploadSlot, std::string(path)));
    if(!store.commit(commit)) {
        setError(response, "storage", "could not store the file");
        return;
    }

    response["ok"] = true;
    response["path"] = path;
    response["size"] = size;
    response["crc"] = hex32(crc);
    response["generation"] = store.generation();
}

void ConfigApi::opDelete(JsonObjectConst request, JsonDocument& response) {
    if(!this->checkWriteAccess(response)) {
        return;
    }
    IRole* role = RoleManager::getManager()->current();
    if(role != nullptr && !role->storeEditable()) {
        setError(response, "busy", "program files cannot be changed now (game or sync running)");
        return;
    }
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        setError(response, "bad_path", BAD_PATH_MESSAGE);
        return;
    }
    if(!ProgramStore::get().remove(path)) {
        setError(response, "not_found", String(path) + " does not exist");
        return;
    }
    response["ok"] = true;
    response["path"] = path;
    response["generation"] = ProgramStore::get().generation();
}

void ConfigApi::opValidate(JsonObjectConst request, JsonDocument& response) {
    IRole* role = RoleManager::getManager()->current();
    if(role != nullptr && !role->engineIdle()) {
        setError(response, "busy", "a program is selected or running; validate in the program menu");
        return;
    }
    const char* path = request["path"];
    JsonVariantConst data = request["data"];
    if(!data.isNull()) {
        // dry run: the program text comes with the request, nothing is stored
        if(!data.is<const char*>()) {
            setError(response, "bad_request", "'data' must be a string");
            return;
        }
        if(!ProgramStore::isValidPath(path)) {
            setError(response, "bad_path", BAD_PATH_MESSAGE);
            return;
        }
    } else if(!ProgramStore::isValidPath(path) || !ProgramStore::get().exists(path)) {
        setError(response, "not_found", "program file not found");
        return;
    }
    BlockManager* bm = BlockManager::getManager();
    if(!bm->loadProgram(path, data.as<const char*>())) {
        setError(response, "invalid_program", bm->getLastError());
        return;
    }
    response["ok"] = true;
    response["path"] = path;
    response["blocks"] = bm->blockCount();
}
