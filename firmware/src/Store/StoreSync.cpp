#include "StoreSync.h"

using namespace Protocol;

static const char* TAG = "SYNC";

// temp slot 0 is used by phone uploads, sync uses 1 ..
static const uint8_t FIRST_SYNC_SLOT = 1;

StoreState StoreSync::localState() {
    StoreState state;
    state.generation = ProgramStore::get().generation();
    state.hash = ProgramStore::get().hash();
    return state;
}

static bool isNewer(const StoreState& theirs, const StoreState& ours) {
    if(theirs.generation != ours.generation) {
        return theirs.generation > ours.generation;
    }
    // same generation, different content: the higher hash wins, so all pods converge
    return theirs.hash > ours.hash;
}

void StoreSync::peerState(const uint8_t* mac, const StoreState& state, bool peerAllowsPull) {
    this->store.noteSeenGeneration(state.generation);

    if(this->phase != Phase::IDLE) {
        if(EspNowLink::sameMac(mac, this->sourceMac)) {
            this->peerAllows = peerAllowsPull;
            if(state.generation != this->source.generation || state.hash != this->source.hash) {
                this->abortPull("source changed");
            }
        }
        return;
    }

    if(!this->pullAllowed || !peerAllowsPull || esp_timer_get_time() < this->pausedUntilUs) {
        return;
    }
    if(isNewer(state, StoreSync::localState())) {
        this->peerAllows = true;
        this->startPull(mac, state);
    }
}

bool StoreSync::handleFrame(const RxFrame& frame) {
    const Header* header = reinterpret_cast<const Header*>(frame.data);
    if(header->setId != this->setId) {
        return header->type == MsgType::SYNC_READ_REQ || header->type == MsgType::SYNC_READ_RESP;
    }
    switch(header->type) {
        case MsgType::SYNC_READ_REQ:
            if(frame.len >= sizeof(SyncReadReq)) {
                this->serve(frame);
            }
            return true;
        case MsgType::SYNC_READ_RESP:
            if(frame.len >= frameSize(MsgType::SYNC_READ_RESP) && this->phase != Phase::IDLE
                && EspNowLink::sameMac(frame.mac, this->sourceMac)) {
                this->handleResponse(*reinterpret_cast<const SyncReadResp*>(frame.data), frame.len);
            }
            return true;
        default:
            return false;
    }
}

// ---------------------------------------------------------------- serving

void StoreSync::serve(const RxFrame& frame) {
    const SyncReadReq* req = reinterpret_cast<const SyncReadReq*>(frame.data);
    char path[SYNC_PATH_LEN];
    memcpy(path, req->path, SYNC_PATH_LEN);
    path[SYNC_PATH_LEN - 1] = '\0';

    SyncReadResp resp;
    fillHeader(resp.header, MsgType::SYNC_READ_RESP, this->setId);
    resp.reqId = req->reqId;
    resp.status = SyncStatus::OK;
    resp.offset = req->offset;
    resp.total = 0;
    resp.len = 0;

    if(strcmp(path, MANIFEST_PATH) == 0) {
        if(req->offset == 0) {
            this->servedManifest = this->store.manifest();
        }
        resp.total = this->servedManifest.size();
        if(req->offset > resp.total) {
            resp.status = SyncStatus::BAD_OFFSET;
        } else {
            size_t n = std::min((size_t)SYNC_CHUNK, (size_t)(resp.total - req->offset));
            memcpy(resp.data, this->servedManifest.data() + req->offset, n);
            resp.len = (uint8_t)n;
        }
    } else {
        size_t n = 0;
        uint32_t total = 0;
        if(!this->store.read(path, req->offset, resp.data, SYNC_CHUNK, n, total)) {
            resp.status = this->store.exists(path) ? SyncStatus::BAD_OFFSET : SyncStatus::NOT_FOUND;
        }
        resp.total = total;
        resp.len = (uint8_t)n;
    }

    size_t len = offsetof(SyncReadResp, data) + resp.len;
    this->link.send(frame.mac, &resp, (uint8_t)len, 3);
}

// ---------------------------------------------------------------- pulling

void StoreSync::startPull(const uint8_t* mac, const StoreState& state) {
    memcpy(this->sourceMac, mac, 6);
    this->source = state;
    this->phase = Phase::MANIFEST;
    this->manifestText.clear();
    this->entries.clear();
    this->todo.clear();
    this->todoPos = 0;
    this->currentPath = MANIFEST_PATH;
    this->offset = 0;
    this->retries = 0;
    ESP_LOGI(TAG, "pulling store generation %u (hash %08x), ours is %u",
             state.generation, state.hash, this->store.generation());
    this->sendRequest();
}

void StoreSync::sendRequest() {
    SyncReadReq req;
    fillHeader(req.header, MsgType::SYNC_READ_REQ, this->setId);
    req.reqId = ++this->reqId;
    req.offset = this->offset;
    memset(req.path, 0, SYNC_PATH_LEN);
    strncpy(req.path, this->currentPath.c_str(), SYNC_PATH_LEN - 1);

    this->link.send(this->sourceMac, &req, sizeof(req), 3);
    this->requestSentUs = esp_timer_get_time();
}

void StoreSync::service() {
    if(this->phase == Phase::IDLE) {
        return;
    }
    if(!this->pullAllowed || !this->peerAllows) {
        // paused (game running); keep the state, the request is resent when allowed again
        this->requestSentUs = esp_timer_get_time();
        return;
    }
    if(esp_timer_get_time() - this->requestSentUs > REQUEST_TIMEOUT_US) {
        if(++this->retries > MAX_RETRIES) {
            this->abortPull("no answer");
            return;
        }
        this->reqId--;      // resend with the same request id
        this->sendRequest();
    }
}

void StoreSync::handleResponse(const SyncReadResp& resp, size_t frameLen) {
    if(resp.reqId != this->reqId || resp.offset != this->offset) {
        return;     // late answer to an earlier request
    }
    if(frameLen < offsetof(SyncReadResp, data) + resp.len) {
        return;
    }
    if(resp.status != SyncStatus::OK) {
        this->abortPull("file not available");
        return;
    }
    this->retries = 0;

    if(this->phase == Phase::MANIFEST) {
        this->manifestText.append((const char*)resp.data, resp.len);
        this->offset += resp.len;
        if(this->offset < resp.total && resp.len > 0) {
            this->sendRequest();
            return;
        }
        if(!this->parseManifest()) {
            this->abortPull("invalid manifest");
            return;
        }
        this->phase = Phase::FILES;
        this->todoPos = 0;
        this->nextFile();
        return;
    }

    // FILES
    uint8_t slot = FIRST_SYNC_SLOT + this->todoPos;
    if(!this->store.writeTemp(slot, this->offset, resp.data, resp.len)) {
        this->abortPull("temp write failed");
        return;
    }
    this->offset += resp.len;
    if(this->offset < resp.total && resp.len > 0) {
        this->sendRequest();
        return;
    }

    const Entry& entry = this->entries[this->todo[this->todoPos]];
    uint32_t size = 0;
    uint32_t crc = 0;
    if(!this->store.tempInfo(slot, size, crc) || size != entry.size || crc != entry.crc) {
        this->abortPull("CRC mismatch");
        return;
    }
    this->todoPos++;
    this->nextFile();
}

bool StoreSync::parseManifest() {
    this->entries.clear();
    size_t pos = 0;
    while(pos < this->manifestText.size()) {
        size_t end = this->manifestText.find('\n', pos);
        if(end == std::string::npos) {
            return false;
        }
        std::string line = this->manifestText.substr(pos, end - pos);
        pos = end + 1;

        size_t tab1 = line.find('\t');
        size_t tab2 = line.find('\t', tab1 + 1);
        if(tab1 == std::string::npos || tab2 == std::string::npos) {
            return false;
        }
        Entry entry;
        entry.path = line.substr(0, tab1);
        entry.size = strtoul(line.c_str() + tab1 + 1, nullptr, 10);
        entry.crc = strtoul(line.c_str() + tab2 + 1, nullptr, 16);
        if(!ProgramStore::isValidPath(entry.path.c_str()) || entry.size > ProgramStore::MAX_FILE_SIZE) {
            return false;
        }
        this->entries.push_back(entry);
    }

    // only download what differs from our files
    this->todo.clear();
    for(size_t i = 0; i < this->entries.size(); i++) {
        ProgramStore::FileInfo local;
        if(!this->store.fileInfo(this->entries[i].path.c_str(), local)
            || local.size != this->entries[i].size || local.crc != this->entries[i].crc) {
            this->todo.push_back(i);
        }
    }
    if(this->todo.size() > 200) {
        return false;   // more than temp slots
    }
    return true;
}

void StoreSync::nextFile() {
    if(this->todoPos >= this->todo.size()) {
        this->finishPull();
        return;
    }
    this->currentPath = this->entries[this->todo[this->todoPos]].path;
    this->offset = 0;
    if(this->entries[this->todo[this->todoPos]].size == 0) {
        // empty file: nothing to transfer, create it directly
        this->store.writeTemp(FIRST_SYNC_SLOT + this->todoPos, 0, nullptr, 0);
        this->todoPos++;
        this->nextFile();
        return;
    }
    this->sendRequest();
}

void StoreSync::finishPull() {
    ProgramStore::Commit commit;
    for(size_t i = 0; i < this->todo.size(); i++) {
        commit.files.push_back(std::make_pair((uint8_t)(FIRST_SYNC_SLOT + i), this->entries[this->todo[i]].path));
    }
    for(const ProgramStore::FileInfo& local : this->store.list()) {
        bool keep = false;
        for(const Entry& entry : this->entries) {
            if(entry.path == local.path) {
                keep = true;
                break;
            }
        }
        if(!keep) {
            commit.deletes.push_back(local.path);
        }
    }

    this->store.commit(commit, this->source.generation);
    ESP_LOGI(TAG, "sync done: %u files updated, %u deleted", (unsigned)commit.files.size(), (unsigned)commit.deletes.size());
    this->phase = Phase::IDLE;
    if(this->store.hash() != this->source.hash) {
        // should not happen; do not pull the same store again and again
        ESP_LOGW(TAG, "store hash differs from source after sync");
        this->pausedUntilUs = esp_timer_get_time() + 10 * RETRY_PAUSE_US;
    }
}

void StoreSync::abortPull(const char* reason) {
    ESP_LOGW(TAG, "sync aborted: %s", reason);
    this->store.clearTemp();
    this->phase = Phase::IDLE;
    this->pausedUntilUs = esp_timer_get_time() + RETRY_PAUSE_US;
}
