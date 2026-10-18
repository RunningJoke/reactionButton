#include "ProgramStore.h"
#include <SPIFFS.h>
#include <algorithm>
#include <esp_rom_crc.h>
#include <ArduinoJson.h>
#include "Settings/Settings.h"

static const char* TAG = "STORE";
static const char* INDEX_PATH = "/programs.json";
static const char* PROGRAM_DIR = "/prog/";
static const char* TEMP_DIR = "/t/";

ProgramStore& ProgramStore::get() {
    static ProgramStore store;
    return store;
}

void ProgramStore::begin() {
    this->gen = Settings::getStoreGeneration();
    this->seenGen = Settings::getSeenGeneration();
    this->clearTemp();
    this->updateHash();

    // files replaced from outside the firmware (pio uploadfs): treat like a local change,
    // otherwise an older store of another pod with the same generation could win
    if(this->storeHash != Settings::getStoreHash()) {
        this->gen = std::max(this->gen, this->seenGen) + 1;
        Settings::setStoreGeneration(this->gen);
        Settings::setStoreHash(this->storeHash);
        ESP_LOGI(TAG, "program files changed outside the firmware, new generation");
    }
    ESP_LOGI(TAG, "store generation %u, hash %08x", this->gen, this->storeHash);
}

uint32_t ProgramStore::crc32(uint32_t crc, const uint8_t* data, size_t len) {
    return esp_rom_crc32_le(crc, data, len);
}

uint32_t ProgramStore::fileCrc(const char* path, uint32_t& size) {
    File file = SPIFFS.open(path, "r");
    size = 0;
    if(!file) {
        return 0;
    }
    uint32_t crc = 0;
    uint8_t buffer[256];
    while(file.available()) {
        size_t n = file.read(buffer, sizeof(buffer));
        if(n == 0) {
            break;
        }
        crc = ProgramStore::crc32(crc, buffer, n);
        size += n;
    }
    file.close();
    return crc;
}

bool ProgramStore::isValidPath(const char* path) {
    if(path == nullptr) {
        return false;
    }
    size_t len = strlen(path);
    if(len > MAX_PATH) {
        return false;
    }
    if(strcmp(path, INDEX_PATH) == 0) {
        return true;
    }
    size_t prefix = strlen(PROGRAM_DIR);
    if(len <= prefix || strncmp(path, PROGRAM_DIR, prefix) != 0 || path[len - 1] == '/') {
        return false;
    }
    for(size_t i = prefix; i < len; i++) {
        char c = path[i];
        bool ok = isalnum((unsigned char)c) || c == '_' || c == '-' || c == '.' || c == '/';
        if(!ok || (c == '.' && i + 1 < len && path[i + 1] == '.') || (c == '/' && path[i - 1] == '/')) {
            return false;
        }
    }
    return true;
}

std::vector<ProgramStore::FileInfo> ProgramStore::list() const {
    std::vector<FileInfo> files;
    File root = SPIFFS.open("/");
    if(!root) {
        return files;
    }
    File file = root.openNextFile();
    while(file) {
        std::string path = file.path();
        file.close();
        if(ProgramStore::isValidPath(path.c_str())) {
            FileInfo info;
            info.path = path;
            info.crc = ProgramStore::fileCrc(path.c_str(), info.size);
            files.push_back(info);
        }
        file = root.openNextFile();
    }
    root.close();
    std::sort(files.begin(), files.end(), [](const FileInfo& a, const FileInfo& b) { return a.path < b.path; });
    return files;
}

bool ProgramStore::exists(const char* path) const {
    return ProgramStore::isValidPath(path) && SPIFFS.exists(path);
}

bool ProgramStore::fileInfo(const char* path, FileInfo& info) const {
    if(!this->exists(path)) {
        return false;
    }
    info.path = path;
    info.crc = ProgramStore::fileCrc(path, info.size);
    return true;
}

bool ProgramStore::read(const char* path, uint32_t offset, uint8_t* buffer, size_t maxLen, size_t& len, uint32_t& total) const {
    len = 0;
    if(!this->exists(path)) {
        return false;
    }
    File file = SPIFFS.open(path, "r");
    if(!file) {
        return false;
    }
    total = file.size();
    if(offset > total) {
        file.close();
        return false;
    }
    file.seek(offset);
    len = file.read(buffer, maxLen);
    file.close();
    return true;
}

std::string ProgramStore::manifest() const {
    std::string out;
    char line[64];
    for(const FileInfo& f : this->list()) {
        snprintf(line, sizeof(line), "\t%u\t%08x\n", (unsigned)f.size, (unsigned)f.crc);
        out += f.path;
        out += line;
    }
    return out;
}

void ProgramStore::updateHash() {
    std::string m = this->manifest();
    this->storeHash = ProgramStore::crc32(0, (const uint8_t*)m.data(), m.size());
}

size_t ProgramStore::freeBytes() const {
    return SPIFFS.totalBytes() - SPIFFS.usedBytes();
}

std::string ProgramStore::tempPath(uint8_t slot) {
    return std::string(TEMP_DIR) + std::to_string(slot);
}

bool ProgramStore::writeTemp(uint8_t slot, uint32_t offset, const uint8_t* data, size_t len) {
    std::string path = ProgramStore::tempPath(slot);

    if(offset == 0) {
        SPIFFS.remove(path.c_str());
    } else {
        File existing = SPIFFS.open(path.c_str(), "r");
        uint32_t size = existing ? existing.size() : 0;
        if(existing) existing.close();
        if(!existing || size != offset) {
            ESP_LOGW(TAG, "temp %u: offset %u does not continue size %u", slot, offset, size);
            return false;
        }
    }
    if(offset + len > MAX_FILE_SIZE) {
        return false;
    }

    File file = SPIFFS.open(path.c_str(), offset == 0 ? "w" : "a");
    if(!file) {
        return false;
    }
    size_t written = len > 0 ? file.write(data, len) : 0;
    file.close();
    return written == len;
}

bool ProgramStore::tempInfo(uint8_t slot, uint32_t& size, uint32_t& crc) const {
    std::string path = ProgramStore::tempPath(slot);
    if(!SPIFFS.exists(path.c_str())) {
        return false;
    }
    crc = ProgramStore::fileCrc(path.c_str(), size);
    return true;
}

bool ProgramStore::tempIsValidJson(uint8_t slot, String& error) const {
    std::string path = ProgramStore::tempPath(slot);
    File file = SPIFFS.open(path.c_str(), "r");
    if(!file) {
        error = "no data";
        return false;
    }
    JsonDocument doc;
    DeserializationError result = deserializeJson(doc, file);
    file.close();
    if(result) {
        error = result.c_str();
        return false;
    }
    return true;
}

void ProgramStore::clearTemp() {
    std::vector<std::string> temps;
    File root = SPIFFS.open("/");
    if(!root) {
        return;
    }
    File file = root.openNextFile();
    while(file) {
        std::string path = file.path();
        file.close();
        if(path.compare(0, strlen(TEMP_DIR), TEMP_DIR) == 0) {
            temps.push_back(path);
        }
        file = root.openNextFile();
    }
    root.close();
    for(const std::string& path : temps) {
        SPIFFS.remove(path.c_str());
    }
}

bool ProgramStore::commit(const Commit& commit, uint32_t generation) {
    bool ok = true;
    for(const auto& entry : commit.files) {
        std::string temp = ProgramStore::tempPath(entry.first);
        if(!ProgramStore::isValidPath(entry.second.c_str()) || !SPIFFS.exists(temp.c_str())) {
            ok = false;
            continue;
        }
        SPIFFS.remove(entry.second.c_str());
        if(!SPIFFS.rename(temp.c_str(), entry.second.c_str())) {
            ESP_LOGE(TAG, "rename to %s failed", entry.second.c_str());
            ok = false;
        }
    }
    for(const std::string& path : commit.deletes) {
        if(ProgramStore::isValidPath(path.c_str())) {
            SPIFFS.remove(path.c_str());
        }
    }

    this->gen = generation != 0 ? generation : std::max(this->gen, this->seenGen) + 1;
    Settings::setStoreGeneration(this->gen);
    this->updateHash();
    Settings::setStoreHash(this->storeHash);
    ESP_LOGI(TAG, "store committed: generation %u, hash %08x", this->gen, this->storeHash);
    return ok;
}

void ProgramStore::noteSeenGeneration(uint32_t generation) {
    if(generation > this->seenGen) {
        this->seenGen = generation;
        Settings::setSeenGeneration(generation);
    }
}

bool ProgramStore::remove(const char* path) {
    if(!this->exists(path)) {
        return false;
    }
    Commit c;
    c.deletes.push_back(path);
    return this->commit(c);
}
