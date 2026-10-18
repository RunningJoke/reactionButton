#include "PhoneConfig.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <SPIFFS.h>
#include "_Definitions.h"
#include "Link/Protocol.h"
#include "Store/ProgramStore.h"
#include "Settings/Settings.h"
#include "BlockManager/BlockManager.h"
#include "Block/BlockFactory/BlockFactory.h"

static const char* TAG = "PHONE";

// shared between the BLE task (callbacks) and the main loop
static StreamBufferHandle_t rxBuffer = nullptr;
static volatile bool rxOverflow = false;
static volatile uint16_t peerMtu = 23;

namespace {
    class CommandCallbacks : public BLECharacteristicCallbacks {
        void onWrite(BLECharacteristic* characteristic) override {
            std::string value = characteristic->getValue();
            if(rxBuffer == nullptr || value.empty()) {
                return;
            }
            if(xStreamBufferSend(rxBuffer, value.data(), value.size(), 0) != value.size()) {
                rxOverflow = true;
            }
        }
    };

    class ServerCallbacks : public BLEServerCallbacks {
        void onConnect(BLEServer* server) override {
            peerMtu = 23;
        }
        void onDisconnect(BLEServer* server) override {
            // let the configuration software reconnect
            BLEDevice::startAdvertising();
        }
        void onMtuChanged(BLEServer* server, esp_ble_gatts_cb_param_t* param) override {
            peerMtu = param->mtu.mtu;
        }
    };

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
}

void PhoneConfig::start() {
    rxBuffer = xStreamBufferCreate(MAX_REQUEST + 1024, 1);

    BLEDevice::init("ReactPod Config");
    BLEDevice::setMTU(517);
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    this->maxLoopCharacteristic = pService->createCharacteristic(
        CHAR_MAX_LOOP_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );
    this->maxLoopCharacteristic->setValue("-1");

    this->commandCharacteristic = pService->createCharacteristic(
        CHAR_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    this->commandCharacteristic->setCallbacks(new CommandCallbacks());

    this->responseCharacteristic = pService->createCharacteristic(
        CHAR_RESPONSE_UUID, BLECharacteristic::PROPERTY_INDICATE | BLECharacteristic::PROPERTY_NOTIFY
    );
    this->responseCharacteristic->addDescriptor(new BLE2902());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMaxPreferred(0x12);
    BLEDevice::startAdvertising();

    this->running = true;
}

void PhoneConfig::stop() {
    if(!this->running) {
        return;
    }
    BLEDevice::stopAdvertising();
    // keep the controller memory: releasing it is not reversible and not needed
    BLEDevice::deinit(false);
    this->running = false;
    if(this->uploadActive) {
        ProgramStore::get().clearTemp();
        this->uploadActive = false;
    }
}

bool PhoneConfig::getMaxLoops(int64_t& maxLoops) const {
    if(this->maxLoopCharacteristic == nullptr) {
        return false;
    }
    std::string value = this->maxLoopCharacteristic->getValue();
    char* end = nullptr;
    long long parsed = strtoll(value.c_str(), &end, 10);
    if(end == value.c_str() || *end != '\0' || parsed <= 0) {
        return false;
    }
    maxLoops = parsed;
    return true;
}

bool PhoneConfig::takeStoreChanged() {
    bool changed = this->storeChanged;
    this->storeChanged = false;
    return changed;
}

// ---------------------------------------------------------------- request framing

void PhoneConfig::service() {
    if(!this->running || rxBuffer == nullptr) {
        return;
    }

    if(rxOverflow) {
        rxOverflow = false;
        this->line.clear();
        this->discarding = true;
        JsonDocument response;
        this->sendError(response, "overflow", "request data arrived faster than it could be processed");
    }

    char buffer[256];
    size_t n;
    while((n = xStreamBufferReceive(rxBuffer, buffer, sizeof(buffer), 0)) > 0) {
        for(size_t i = 0; i < n; i++) {
            char c = buffer[i];
            if(c == '\n') {
                if(!this->discarding && !this->line.empty()) {
                    this->handleRequest(this->line);
                }
                this->line.clear();
                this->discarding = false;
                continue;
            }
            if(this->discarding) {
                continue;
            }
            if(this->line.size() >= MAX_REQUEST) {
                this->line.clear();
                this->discarding = true;
                JsonDocument response;
                this->sendError(response, "too_large", "request longer than " + String((unsigned)MAX_REQUEST) + " bytes");
                continue;
            }
            this->line += c;
        }
    }
}

void PhoneConfig::sendResponse(JsonDocument& response) {
    std::string out;
    serializeJson(response, out);
    out += '\n';

    size_t chunk = peerMtu > 3 ? peerMtu - 3 : 20;
    for(size_t pos = 0; pos < out.size(); pos += chunk) {
        size_t n = std::min(chunk, out.size() - pos);
        this->responseCharacteristic->setValue((uint8_t*)out.data() + pos, n);
        this->responseCharacteristic->indicate();   // waits for the confirmation (flow control)
    }
}

void PhoneConfig::sendError(JsonDocument& response, const char* code, const String& message) {
    response["ok"] = false;
    response["error"] = code;
    response["message"] = message;
    ESP_LOGW(TAG, "%s: %s", code, message.c_str());
    this->sendResponse(response);
}

void PhoneConfig::handleRequest(const std::string& text) {
    JsonDocument request;
    JsonDocument response;

    DeserializationError error = deserializeJson(request, text);
    if(error) {
        this->sendError(response, "bad_request", String("invalid JSON: ") + error.c_str());
        return;
    }

    const char* op = request["op"] | "";
    response["op"] = op;
    if(!request["id"].isNull()) {
        response["id"] = request["id"];
    }

    JsonObjectConst req = request.as<JsonObjectConst>();
    if(strcmp(op, "info") == 0) this->opInfo(response);
    else if(strcmp(op, "list") == 0) this->opList(response);
    else if(strcmp(op, "get") == 0) this->opGet(req, response);
    else if(strcmp(op, "put") == 0) this->opPut(req, response);
    else if(strcmp(op, "delete") == 0) this->opDelete(req, response);
    else if(strcmp(op, "validate") == 0) this->opValidate(req, response);
    else {
        this->sendError(response, "bad_request", String("unknown op '") + op + "'");
        return;
    }
}

// ---------------------------------------------------------------- operations

void PhoneConfig::opInfo(JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    response["ok"] = true;
    response["firmware"] = String(FW_VERSION_MAJOR) + "." + String(FW_VERSION_MINOR);
    response["linkProtocol"] = (uint32_t)Protocol::VERSION;
    response["setId"] = hex32(Settings::getSetId());
    response["generation"] = store.generation();
    response["storeHash"] = hex32(store.hash());
    response["freeBytes"] = store.freeBytes();
    response["maxFileSize"] = (uint32_t)ProgramStore::MAX_FILE_SIZE;
    response["maxPathLength"] = (uint32_t)ProgramStore::MAX_PATH;
    response["maxRequest"] = (uint32_t)MAX_REQUEST;
    response["maxGetChunk"] = (uint32_t)MAX_GET_CHUNK;
    response["mtu"] = (uint32_t)peerMtu;
    JsonArray types = response["blockTypes"].to<JsonArray>();
    for(size_t i = 0; BlockFactory::typeName(i) != nullptr; i++) {
        types.add(BlockFactory::typeName(i));
    }
    this->sendResponse(response);
}

void PhoneConfig::opList(JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    response["ok"] = true;
    response["generation"] = store.generation();
    response["storeHash"] = hex32(store.hash());

    JsonArray files = response["files"].to<JsonArray>();
    for(const ProgramStore::FileInfo& f : store.list()) {
        JsonObject entry = files.add<JsonObject>();
        entry["path"] = f.path;
        entry["size"] = f.size;
        entry["crc"] = hex32(f.crc);
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
    this->sendResponse(response);
}

void PhoneConfig::opGet(JsonObjectConst request, JsonDocument& response) {
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        this->sendError(response, "bad_path", "path must be /programs.json or /prog/... (max 31 characters)");
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
            this->sendError(response, "bad_offset", "offset beyond end of file");
        } else {
            this->sendError(response, "not_found", String(path) + " does not exist");
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
    this->sendResponse(response);
}

void PhoneConfig::opPut(JsonObjectConst request, JsonDocument& response) {
    ProgramStore& store = ProgramStore::get();
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        this->sendError(response, "bad_path", "path must be /programs.json or /prog/... (max 31 characters)");
        return;
    }
    if(!request["data"].is<const char*>()) {
        this->sendError(response, "bad_request", "'data' (string) missing");
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
        this->sendError(response, "bad_offset", "expected offset " + String(this->uploadOffset) + " for " + this->uploadPath.c_str());
        return;
    }
    if(offset + len > ProgramStore::MAX_FILE_SIZE) {
        this->uploadActive = false;
        this->sendError(response, "too_large", "file larger than " + String((uint32_t)ProgramStore::MAX_FILE_SIZE) + " bytes");
        return;
    }
    if(!store.writeTemp(UPLOAD_SLOT, offset, (const uint8_t*)data, len)) {
        this->uploadActive = false;
        this->sendError(response, "storage", "could not write to flash (full?)");
        return;
    }
    this->uploadOffset = offset + len;

    if(!final) {
        response["ok"] = true;
        response["path"] = path;
        response["received"] = this->uploadOffset;
        this->sendResponse(response);
        return;
    }

    // final chunk: check and commit
    this->uploadActive = false;
    uint32_t size = 0;
    uint32_t crc = 0;
    store.tempInfo(UPLOAD_SLOT, size, crc);

    uint32_t expectedCrc;
    if(!request["crc"].isNull() && (!parseCrc(request["crc"], expectedCrc) || expectedCrc != crc)) {
        store.clearTemp();
        this->sendError(response, "crc_mismatch", "received data has CRC " + hex32(crc));
        return;
    }
    String jsonError;
    if(!store.tempIsValidJson(UPLOAD_SLOT, jsonError)) {
        store.clearTemp();
        this->sendError(response, "invalid_json", jsonError);
        return;
    }

    ProgramStore::Commit commit;
    commit.files.push_back(std::make_pair(UPLOAD_SLOT, std::string(path)));
    if(!store.commit(commit)) {
        this->sendError(response, "storage", "could not store the file");
        return;
    }
    this->storeChanged = true;

    response["ok"] = true;
    response["path"] = path;
    response["size"] = size;
    response["crc"] = hex32(crc);
    response["generation"] = store.generation();
    this->sendResponse(response);
}

void PhoneConfig::opDelete(JsonObjectConst request, JsonDocument& response) {
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path)) {
        this->sendError(response, "bad_path", "path must be /programs.json or /prog/... (max 31 characters)");
        return;
    }
    if(!ProgramStore::get().remove(path)) {
        this->sendError(response, "not_found", String(path) + " does not exist");
        return;
    }
    this->storeChanged = true;
    response["ok"] = true;
    response["path"] = path;
    response["generation"] = ProgramStore::get().generation();
    this->sendResponse(response);
}

void PhoneConfig::opValidate(JsonObjectConst request, JsonDocument& response) {
    const char* path = request["path"];
    if(!ProgramStore::isValidPath(path) || !ProgramStore::get().exists(path)) {
        this->sendError(response, "not_found", "program file not found");
        return;
    }
    BlockManager* bm = BlockManager::getManager();
    if(!bm->loadProgram(path)) {
        this->sendError(response, "invalid_program", bm->getLastError());
        return;
    }
    response["ok"] = true;
    response["path"] = path;
    response["blocks"] = bm->blockCount();
    this->sendResponse(response);
}
