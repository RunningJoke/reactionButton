#pragma once

#include <Arduino.h>
#include <string>
#include <vector>
#include "Link/EspNowLink.h"
#include "Link/Protocol.h"
#include "Store/ProgramStore.h"

/**
 * Keeps the program store equal on all pods of a set. Runs on central and peripherals.
 *
 * Every PING/PONG carries the sender's store generation and hash (peerState()). If a peer
 * has a newer store (higher generation, or same generation and higher hash), this pod
 * pulls it:
 *   1. read the peer's manifest (virtual file "@manifest")
 *   2. read every file that is missing or different into a temp file, check size + CRC
 *   3. commit: rename the temp files into place, delete files the peer does not have,
 *      take over the peer's generation
 * One request is outstanding at a time (stop-and-wait), so sync never floods the link.
 * The other side only answers requests (serve) and needs no state.
 *
 * Pulling only happens while allowed (central: not during a game). An interrupted pull
 * leaves the old store untouched and starts again later.
 */
class StoreSync {
    public:
        explicit StoreSync(uint32_t setId) : setId(setId) {}

        void setSetId(uint32_t id) { this->setId = id; }

        // Our own permission to pull (central: false while a game runs)
        void setPullAllowed(bool allowed) { this->pullAllowed = allowed; }

        // Store state reported by a peer. peerAllowsPull = the peer is ready to serve us.
        void peerState(const uint8_t* mac, const Protocol::StoreState& state, bool peerAllowsPull);

        // SYNC_READ_REQ / SYNC_READ_RESP. Returns true if the frame was a sync frame.
        bool handleFrame(const RxFrame& frame);

        // Drives a running pull (timeouts, next request). Call once per loop pass.
        void service();

        bool isPulling() const { return this->phase != Phase::IDLE; }

        static Protocol::StoreState localState();

    private:
        enum class Phase : uint8_t { IDLE, MANIFEST, FILES };

        struct Entry {
            std::string path;
            uint32_t size;
            uint32_t crc;
        };

        static const int64_t REQUEST_TIMEOUT_US = 300000;
        static const uint8_t MAX_RETRIES = 5;
        static const int64_t RETRY_PAUSE_US = 3000000;

        void serve(const RxFrame& frame);
        void handleResponse(const Protocol::SyncReadResp& resp, size_t frameLen);
        void startPull(const uint8_t* mac, const Protocol::StoreState& state);
        void sendRequest();
        void nextFile();
        void finishPull();
        void abortPull(const char* reason);
        bool parseManifest();

        EspNowLink& link = EspNowLink::get();
        ProgramStore& store = ProgramStore::get();
        uint32_t setId;
        bool pullAllowed = true;
        bool peerAllows = false;

        // pull state
        Phase phase = Phase::IDLE;
        uint8_t sourceMac[6];
        Protocol::StoreState source = {0, 0};
        std::string manifestText;
        std::vector<Entry> entries;     // complete manifest of the source
        std::vector<size_t> todo;       // indices into entries that must be downloaded
        size_t todoPos = 0;
        std::string currentPath;
        uint32_t offset = 0;
        uint8_t reqId = 0;
        int64_t requestSentUs = 0;
        uint8_t retries = 0;
        int64_t pausedUntilUs = 0;

        // serving: manifest snapshot so all chunks of one transfer match
        std::string servedManifest;
};
