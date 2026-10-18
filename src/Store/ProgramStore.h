#pragma once

#include <Arduino.h>
#include <string>
#include <vector>

/**
 * The program files on SPIFFS that can be changed via the phone API and are synchronised
 * between pods: "/programs.json" and everything below "/prog/".
 *
 * - Every file has a CRC32. The store hash is a CRC32 over the sorted manifest
 *   ("path\tsize\tcrc\n" per file), so two pods with the same hash have the same files.
 * - The generation (kept in NVS) increases on every change. Sync copies from the higher
 *   generation to the lower one (see StoreSync).
 * - Writes go to temporary files ("/t/<slot>") first and are renamed into place by
 *   commit(), so a half-transferred file never replaces a good one.
 */
class ProgramStore {
    public:
        struct FileInfo {
            std::string path;
            uint32_t size;
            uint32_t crc;
        };

        static const uint32_t MAX_FILE_SIZE = 16384;
        static const uint8_t MAX_PATH = 31;     // SPIFFS object name limit (32 incl. terminator)

        static ProgramStore& get();

        // Computes the store hash. Call once after SPIFFS is mounted.
        void begin();

        // true for "/programs.json" and "/prog/<name>" with safe characters, <= 31 chars
        static bool isValidPath(const char* path);

        std::vector<FileInfo> list() const;
        bool exists(const char* path) const;
        bool fileInfo(const char* path, FileInfo& info) const;

        // Reads up to maxLen bytes at offset. total = file size.
        bool read(const char* path, uint32_t offset, uint8_t* buffer, size_t maxLen, size_t& len, uint32_t& total) const;

        // "path\tsize\tcrc-hex\n" for every file, sorted by path
        std::string manifest() const;

        // --- temporary files (uploads, sync) ---
        // offset 0 starts a new temp file; other offsets must continue at the current end
        bool writeTemp(uint8_t slot, uint32_t offset, const uint8_t* data, size_t len);
        bool tempInfo(uint8_t slot, uint32_t& size, uint32_t& crc) const;
        // Checks that a temp file is syntactically valid JSON
        bool tempIsValidJson(uint8_t slot, String& error) const;
        void clearTemp();

        struct Commit {
            std::vector<std::pair<uint8_t, std::string>> files;  // temp slot -> final path
            std::vector<std::string> deletes;
        };

        // Moves temp files into place, deletes files, sets the generation
        // (0 = local change: above the current and every generation seen from peers)
        bool commit(const Commit& commit, uint32_t generation = 0);

        // Deletes one file (generation + 1)
        bool remove(const char* path);

        uint32_t generation() const { return this->gen; }

        // Remember a generation reported by a peer (stored when it is a new maximum)
        void noteSeenGeneration(uint32_t generation);
        uint32_t hash() const { return this->storeHash; }
        size_t freeBytes() const;

        static uint32_t crc32(uint32_t crc, const uint8_t* data, size_t len);
        static uint32_t fileCrc(const char* path, uint32_t& size);

    private:
        ProgramStore() {}
        void updateHash();
        static std::string tempPath(uint8_t slot);

        uint32_t gen = 0;
        uint32_t seenGen = 0;
        uint32_t storeHash = 0;
};
