#include "PodNetwork.h"
#include <algorithm>
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/Identity.h"
#include "Battery/Battery.h"
#include "Ota/Ota.h"
#include <esp_wifi.h>

using namespace Protocol;

static const char* TAG = "PODNET";

bool PodNetwork::begin(uint32_t setId) {
    this->setId = setId;
    this->sync.setSetId(setId);
    return this->link.begin(ESPNOW_CHANNEL);
}

void PodNetwork::setSyncAllowed(bool allowed) {
    this->syncAllowed = allowed;
    this->sync.setPullAllowed(allowed);
}

void PodNetwork::setAcceptNewPods(bool accept, uint8_t maxPods) {
    this->acceptNew = accept;
    this->maxPods = maxPods;
}

void PodNetwork::endGame() {
    for(uint8_t i = 0; i < this->pods.size(); i++) {
        this->reset(i);
    }
    this->events.clear();
    this->acceptNew = false;
    this->claimPending = false;
    this->setSyncAllowed(false);
    this->otaStop();
}

void PodNetwork::keepPods(uint8_t maxPods) {
    if(this->pods.size() > maxPods) {
        this->pods.resize(maxPods);
    }
}

int16_t PodNetwork::findPod(const uint8_t* mac) const {
    for(size_t i = 0; i < this->pods.size(); i++) {
        if(EspNowLink::sameMac(this->pods[i].mac, mac)) {
            return (int16_t)i;
        }
    }
    return -1;
}

bool PodNetwork::isAlive(uint8_t podId) const {
    if(podId >= this->pods.size()) {
        return false;
    }
    return esp_timer_get_time() - this->pods[podId].lastSeenUs < POD_TIMEOUT_US;
}

bool PodNetwork::allAlive() const {
    for(uint8_t i = 0; i < this->pods.size(); i++) {
        if(!this->isAlive(i)) {
            return false;
        }
    }
    return true;
}

void PodNetwork::service() {
    this->link.service();

    if(this->claimPending && esp_timer_get_time() - this->claimSentUs > CLAIM_TIMEOUT_US) {
        this->claimPending = false;     // no answer, try the next HELLO
    }

    RxFrame frame;
    while(this->link.receive(frame)) {
        const Header* header = reinterpret_cast<const Header*>(frame.data);
        if(frame.len < frameSize(header->type)) {
            continue;
        }

        if(header->type == MsgType::HELLO) {
            this->handleHello(frame);
            continue;
        }
        if(header->setId != this->setId) {
            continue;   // other set
        }

        if(header->type == MsgType::CLAIM_ACK) {
            this->handleClaimAck(frame);
            continue;
        }

        int16_t podId = this->findPod(frame.mac);
        if(podId < 0) {
            continue;
        }
        this->pods[podId].lastSeenUs = esp_timer_get_time();

        if(this->sync.handleFrame(frame)) {
            continue;
        }

        switch(header->type) {
            case MsgType::PING:
                this->handlePing(frame, podId);
                break;
            case MsgType::PRESSED:
                this->handlePressed(frame, podId);
                break;
            case MsgType::RELEASED:
                this->handleReleased(frame, podId);
                break;
            default:
                break;
        }
    }

    this->sync.service();
    this->otaService();
}

void PodNetwork::sendClaim(const uint8_t* mac, uint8_t podId) {
    Claim claim;
    fillHeader(claim.header, MsgType::CLAIM, this->setId);
    claim.podId = podId;
    this->link.send(mac, &claim, sizeof(claim), 3);
}

void PodNetwork::handleHello(const RxFrame& frame) {
    const Hello* hello = reinterpret_cast<const Hello*>(frame.data);
    if(hello->header.setId != 0 && hello->header.setId != this->setId) {
        ESP_LOGD(TAG, "ignoring pod of set %08x", hello->header.setId);
        return;
    }

    int16_t known = this->findPod(frame.mac);
    if(known >= 0) {
        // pod rebooted or lost us: take it back with the same id
        this->pods[known].fwMajor = hello->fwMajor;
        this->pods[known].fwMinor = hello->fwMinor;
        this->sendClaim(frame.mac, (uint8_t)known);
        return;
    }

    if(!this->acceptNew || this->pods.size() >= this->maxPods || this->claimPending) {
        return;
    }

    this->claimPending = true;
    memcpy(this->claimMac, frame.mac, 6);
    this->claimFwMajor = hello->fwMajor;
    this->claimFwMinor = hello->fwMinor;
    this->claimSentUs = esp_timer_get_time();
    this->sendClaim(frame.mac, (uint8_t)this->pods.size());
    ESP_LOGI(TAG, "claiming pod %u (fw %u.%u)", (unsigned)this->pods.size(), hello->fwMajor, hello->fwMinor);
}

void PodNetwork::handleClaimAck(const RxFrame& frame) {
    const ClaimAck* ack = reinterpret_cast<const ClaimAck*>(frame.data);

    // appended field: pods with older firmware send a shorter CLAIM_ACK (no features)
    uint8_t features = frame.len >= sizeof(ClaimAck) ? ack->linkFeatures : 0;

    int16_t known = this->findPod(frame.mac);
    if(known >= 0) {
        this->pods[known].lastSeenUs = esp_timer_get_time();
        this->pods[known].linkFeatures = features;     // the pod may have been updated
        return;
    }

    if(!this->claimPending || !EspNowLink::sameMac(this->claimMac, frame.mac) || ack->podId != this->pods.size()) {
        return;
    }
    this->claimPending = false;

    Pod pod;
    memcpy(pod.mac, frame.mac, 6);
    pod.lastSeenUs = esp_timer_get_time();
    pod.linkFeatures = features;
    pod.fwMajor = this->claimFwMajor;
    pod.fwMinor = this->claimFwMinor;
    this->ota.lastJoinUs = pod.lastSeenUs;
    this->pods.push_back(pod);
    ESP_LOGI(TAG, "pod %u joined (link features %02x)", ack->podId, features);
}

void PodNetwork::handlePing(const RxFrame& frame, int16_t podId) {
    const Ping* ping = reinterpret_cast<const Ping*>(frame.data);

    Pong pong;
    fillHeader(pong.header, MsgType::PONG, this->setId);
    pong.t1 = ping->t1;
    pong.t2 = frame.rxUs;
    pong.t3 = 0;    // stamped by the link when the frame goes to the radio
    pong.store = StoreSync::localState();
    pong.flags = (this->syncAllowed ? PONG_FLAG_SYNC_ALLOWED : 0) | (this->identify ? PONG_FLAG_IDENTIFY : 0)
               | (this->ota.active ? PONG_FLAG_OTA : 0)
               | (this->ota.active && this->ota.phase == OtaRun::Phase::PULL ? PONG_FLAG_OTA_PULL : 0);
    this->link.send(this->pods[podId].mac, &pong, sizeof(pong), 0, (int8_t)offsetof(Pong, t3));

    // appended by firmware >= 2.13: a shorter PING (older pod) leaves the level unknown
    this->pods[podId].batteryMv = frame.len >= offsetof(Ping, otaState) ? ping->batteryMv : 0;
    // appended by firmware >= 2.20; without it the pod has no update
    bool hasOta = frame.len >= sizeof(Ping);
    this->pods[podId].otaState = hasOta ? ping->otaState : OTA_POD_NONE;
    this->pods[podId].otaPercent = hasOta ? ping->otaPercent : 0;

    // the peripheral may have a newer program store than we do
    this->sync.peerState(frame.mac, ping->store, true);
}

void PodNetwork::handlePressed(const RxFrame& frame, int16_t podId) {
    const Pressed* pressed = reinterpret_cast<const Pressed*>(frame.data);

    PodEvent event;
    event.podId = (uint8_t)podId;
    event.cmdSeq = pressed->cmdSeq;
    event.result = pressed->result;
    event.reactionUs = pressed->reactionUs;
    event.rxTimeUs = frame.rxUs;
    if(frame.len >= sizeof(Pressed)) {      // appended by firmware >= 2.10, only meaningful for TOGGLE
        event.owner = pressed->owner;
        event.flipCount = pressed->flipCount;
    }
    this->events.push_back(event);
}

void PodNetwork::handleReleased(const RxFrame& frame, int16_t podId) {
    const Released* released = reinterpret_cast<const Released*>(frame.data);

    PodEvent event;
    event.podId = (uint8_t)podId;
    event.cmdSeq = released->cmdSeq;
    event.result = PressResult::HIT;
    event.reactionUs = released->reactionUs;
    event.rxTimeUs = frame.rxUs;
    event.kind = PodEvent::Kind::RELEASED;
    event.flags = released->flags;
    event.heldMs = released->heldMs;
    event.chargeMs = released->chargeMs;
    this->events.push_back(event);
}

uint8_t PodNetwork::arm(uint8_t podId, const ArmCommand& command) {
    if(podId >= this->pods.size()) {
        return 0;
    }
    bool hold = command.mode == PodMode::CHARGE || command.mode == PodMode::RELEASE;
    if(hold && !this->supportsHold(podId)) {
        return 0;   // the caller checks supportsHold first; an older pod would show a wrong mode
    }
    bool toggle = command.mode == PodMode::TOGGLE;
    if(toggle && !this->supportsToggle(podId)) {
        return 0;   // as above, supportsToggle
    }
    Pod& pod = this->pods[podId];
    pod.cmdSeq++;

    Arm arm;
    fillHeader(arm.header, MsgType::ARM, this->setId);
    arm.cmdSeq = pod.cmdSeq;
    arm.mode = command.mode;
    arm.colorActive = command.colorActive;
    arm.colorAfter = command.colorAfter;
    arm.startAtUs = command.startAtUs;
    arm.waiting = command.waiting;
    arm.hold = command.hold;
    arm.toggle = command.toggle;
    // the waiting effect is appended only when the pod plays it; otherwise it shows colorActive.
    // The hold parameters follow the waiting effect, so a hold activation always sends both; the
    // toggle parameters follow the hold parameters (zeroed for a toggle activation).
    bool withEffect = command.waiting.effect != EffectId::NONE && this->supportsEffects(podId);
    if(toggle) {
        memset(&arm.hold, 0, sizeof(arm.hold));
    }
    uint8_t len = toggle ? sizeof(arm) : hold ? offsetof(Arm, toggle)
                : (withEffect ? offsetof(Arm, hold) : offsetof(Arm, waiting));
    this->link.send(pod.mac, &arm, len, 5, -1, true);
    return pod.cmdSeq;
}

bool PodNetwork::supportsEffects(uint8_t podId) const {
    return podId < this->pods.size() && (this->pods[podId].linkFeatures & LINK_FEATURE_EFFECTS) != 0;
}

bool PodNetwork::supportsHold(uint8_t podId) const {
    return podId < this->pods.size() && (this->pods[podId].linkFeatures & LINK_FEATURE_HOLD) != 0;
}

bool PodNetwork::supportsToggle(uint8_t podId) const {
    return podId < this->pods.size() && (this->pods[podId].linkFeatures & LINK_FEATURE_TOGGLE) != 0;
}

bool PodNetwork::effect(uint8_t podId, const EffectDesc& effect, int64_t startAtUs) {
    if(!this->supportsEffects(podId)) {
        return false;
    }
    Effect frame;
    fillHeader(frame.header, MsgType::EFFECT, this->setId);
    frame.effect = effect;
    frame.startAtUs = startAtUs;
    // retried and ordered like RESET, so ARM / RESET / EFFECT keep the order they were sent in
    this->link.send(this->pods[podId].mac, &frame, sizeof(frame), 5, -1, true);
    return true;
}

void PodNetwork::reset(uint8_t podId) {
    if(podId >= this->pods.size()) {
        return;
    }
    Pod& pod = this->pods[podId];
    pod.cmdSeq++;   // events of earlier activations no longer match

    Reset reset;
    fillHeader(reset.header, MsgType::RESET, this->setId);
    this->link.send(pod.mac, &reset, sizeof(reset), 5, -1, true);
}

bool PodNetwork::pollEvent(PodEvent& event) {
    if(this->events.empty()) {
        return false;
    }
    event = this->events.front();
    this->events.pop_front();
    return true;
}

// ---------------------------------------------------------------- firmware distribution (#130, #131, #132)

namespace {
    const int64_t OTA_JOIN_GRACE_US = 2000000;      // pods that are not joined yet get this long after the start / the last join
    const int64_t OTA_OFFER_REPEAT_US = 1500000;    // an offer without an answer is repeated
    const int64_t OTA_PREPARE_MAX_US = 20000000;    // erasing takes 4 s; a pod that needs longer is served later, one by one
    const int64_t OTA_PREPARING_ALIVE_US = 10000000;// a pod that erases does not answer
    const int64_t OTA_CHUNK_PACE_US = 4000;         // broadcast: 4 ms per frame, 0 loss at 1M (#122); 2 ms overruns the driver
}

bool PodNetwork::otaSupported(const Pod& pod) const {
    return (pod.linkFeatures & LINK_FEATURE_OTA) != 0;
}

bool PodNetwork::otaCurrent(const Pod& pod) const {
    char text[8];
    snprintf(text, sizeof(text), "%u.%u", pod.fwMajor, pod.fwMinor);
    return pod.fwMajor != 0 && Ota::imageVersion()[0] != '\0' && strcmp(text, Ota::imageVersion()) == 0;
}

bool PodNetwork::otaAlive(const Pod& pod) const {
    int64_t silent = esp_timer_get_time() - pod.lastSeenUs;
    return silent < (pod.otaState == OTA_POD_PREPARING ? OTA_PREPARING_ALIVE_US : POD_TIMEOUT_US);
}

void PodNetwork::otaStart(OtaMode mode) {
    this->ota = OtaRun();
    this->ota.active = true;
    this->ota.mode = mode;
    this->ota.phaseUs = this->ota.lastJoinUs = esp_timer_get_time();
}

void PodNetwork::otaStop() {
    this->ota.active = false;       // the next PONGs lack PONG_FLAG_OTA: the pods discard their update
}

void PodNetwork::otaOffer(Pod& pod, bool broadcast) {
    OtaOffer offer = {};
    fillHeader(offer.header, MsgType::OTA_OFFER, this->setId);
    offer.size = Ota::imageSize();
    OtaRules::hexToBytes(Ota::imageSha(), offer.sha256);
    offer.flags = broadcast ? OTA_OFFER_FLAG_BROADCAST : 0;
    snprintf(offer.version, sizeof(offer.version), "%s", Ota::imageVersion());
    this->link.send(pod.mac, &offer, sizeof(offer), 5, -1, true);
    pod.otaOfferedUs = esp_timer_get_time();
}

void PodNetwork::otaService() {
    if(!this->ota.active) {
        return;
    }
    Ota::keepAlive();
    int64_t now = esp_timer_get_time();

    if(this->ota.phase == OtaRun::Phase::WAIT) {
        if(now - this->ota.lastJoinUs < OTA_JOIN_GRACE_US) {
            return;
        }
        uint8_t needing = 0;
        for(const Pod& pod : this->pods) {
            needing += this->otaSupported(pod) && !this->otaCurrent(pod) && this->otaAlive(pod) ? 1 : 0;
        }
        bool broadcast = this->ota.mode == OtaMode::BROADCAST || (this->ota.mode == OtaMode::AUTO && needing >= 2);
        this->ota.phase = broadcast ? OtaRun::Phase::PREPARE : OtaRun::Phase::PULL;
        this->ota.phaseUs = now;
        ESP_LOGI(TAG, "distributing %s to %u pod(s), %s", Ota::imageVersion(), (unsigned)needing, broadcast ? "broadcast" : "one at a time");
    }

    if(this->ota.phase == OtaRun::Phase::PREPARE) {
        bool preparing = false;
        bool receiving = false;
        for(Pod& pod : this->pods) {
            if(!this->otaSupported(pod) || this->otaCurrent(pod) || !this->otaAlive(pod)) {
                continue;
            }
            if(pod.otaState == OTA_POD_NONE && now - pod.otaOfferedUs >= OTA_OFFER_REPEAT_US) {
                this->otaOffer(pod, true);
            }
            preparing |= pod.otaState == OTA_POD_NONE || pod.otaState == OTA_POD_PREPARING;
            receiving |= pod.otaState == OTA_POD_RECEIVING;
        }
        if(preparing && now - this->ota.phaseUs < OTA_PREPARE_MAX_US) {
            return;
        }
        this->ota.phase = receiving ? OtaRun::Phase::STREAM : OtaRun::Phase::PULL;
        this->ota.phaseUs = this->ota.nextChunkUs = now;
        this->ota.cursor = 0;
        if(receiving) {
            esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_1M_L);     // sticks until reboot: set it, do not trust the default
        }
        return;
    }

    if(this->ota.phase == OtaRun::Phase::STREAM) {
        uint32_t chunks = OtaBitmap::chunkCount(Ota::imageSize());
        if(this->ota.cursor >= chunks) {
            ESP_LOGI(TAG, "broadcast pass done after %u ms", (unsigned)((now - this->ota.phaseUs) / 1000));
            this->ota.phase = OtaRun::Phase::PULL;
            this->ota.phaseUs = now;
            return;
        }
        if(now < this->ota.nextChunkUs) {
            return;
        }
        OtaChunk chunk;
        fillHeader(chunk.header, MsgType::OTA_CHUNK, this->setId);
        chunk.index = (uint16_t)this->ota.cursor;
        size_t length = 0;
        uint32_t total = 0;
        if(!Ota::readImage(OtaBitmap::chunkOffset(chunk.index), chunk.data, OTA_CHUNK_DATA, length, total)) {
            this->ota.cursor = chunks;      // cannot happen with a verified image; the pull phase takes over
            return;
        }
        if(this->link.broadcast(&chunk, (uint8_t)(offsetof(OtaChunk, data) + length))) {
            this->ota.cursor++;
            // one frame per pace, no burst after a long loop pass
            this->ota.nextChunkUs = std::max(this->ota.nextChunkUs + OTA_CHUNK_PACE_US, now - OTA_CHUNK_PACE_US);
        } else {
            this->ota.nextChunkUs = now + OTA_CHUNK_PACE_US;      // driver queue full
        }
        return;
    }

    // PULL: the pods fetch from us. A pod that has nothing yet is offered the image when no other pod is busy with it.
    bool busy = false;
    for(const Pod& pod : this->pods) {
        busy |= this->otaSupported(pod) && !this->otaCurrent(pod) && this->otaAlive(pod)
                && (pod.otaState == OTA_POD_PREPARING || pod.otaState == OTA_POD_RECEIVING
                    || (pod.otaState == OTA_POD_NONE && now - pod.otaOfferedUs < OTA_OFFER_REPEAT_US));     // offered, no answer yet
    }
    for(Pod& pod : this->pods) {
        if(busy) {
            break;
        }
        if(this->otaSupported(pod) && !this->otaCurrent(pod) && this->otaAlive(pod) && pod.otaState == OTA_POD_NONE
           && now - pod.otaOfferedUs >= OTA_OFFER_REPEAT_US) {
            this->otaOffer(pod, false);
            break;
        }
    }
}

uint8_t PodNetwork::otaPercent() const {
    uint32_t sum = 0;
    uint32_t pods = 0;
    for(const Pod& pod : this->pods) {
        if(this->otaSupported(pod) && !this->otaCurrent(pod)) {
            sum += pod.otaState == OTA_POD_READY ? 100 : pod.otaPercent;
            pods++;
        }
    }
    return OtaRules::overallPercent(sum, pods);
}

std::vector<uint8_t> PodNetwork::otaNotReady() const {
    std::vector<uint8_t> ids;
    for(size_t i = 0; i < this->pods.size(); i++) {
        const Pod& pod = this->pods[i];
        if(!this->otaCurrent(pod) && !(this->otaSupported(pod) && pod.otaState == OTA_POD_READY && this->otaAlive(pod))) {
            ids.push_back((uint8_t)i);
        }
    }
    return ids;
}

uint8_t PodNetwork::otaActivatePods() {
    uint8_t count = 0;
    for(Pod& pod : this->pods) {
        if(this->otaCurrent(pod) || !this->otaSupported(pod) || pod.otaState != OTA_POD_READY || !this->otaAlive(pod)) {
            continue;
        }
        OtaActivate activate = {};
        fillHeader(activate.header, MsgType::OTA_ACTIVATE, this->setId);
        uint8_t digest[32];
        OtaRules::hexToBytes(Ota::imageSha(), digest);
        memcpy(activate.sha256, digest, sizeof(activate.sha256));
        this->link.send(pod.mac, &activate, sizeof(activate), 5, -1, true);
        count++;
    }
    return count;
}

void PodNetwork::otaDescribe(JsonArray out) const {
    for(size_t i = 0; i < this->pods.size(); i++) {
        const Pod& pod = this->pods[i];
        bool current = this->otaCurrent(pod);
        JsonObject entry = out.add<JsonObject>();
        entry["id"] = i;
        entry["state"] = OtaRules::podStateName(pod.otaState, this->otaAlive(pod), current, this->otaSupported(pod));
        entry["percent"] = current ? 100 : pod.otaState == OTA_POD_READY ? 100 : pod.otaPercent;
        if(pod.fwMajor != 0) {
            entry["firmware"] = String(pod.fwMajor) + "." + String(pod.fwMinor);
        }
    }
}

void PodNetwork::describe(JsonArray out) const {
    int64_t now = esp_timer_get_time();
    for(size_t i = 0; i < this->pods.size(); i++) {
        const Pod& pod = this->pods[i];
        JsonObject entry = out.add<JsonObject>();
        char mac[18];
        snprintf(mac, sizeof(mac), "%02x:%02x:%02x:%02x:%02x:%02x",
                 pod.mac[0], pod.mac[1], pod.mac[2], pod.mac[3], pod.mac[4], pod.mac[5]);
        entry["id"] = i;
        entry["number"] = Identity::numberOf((uint8_t)i);
        ColorSet rgb = {0, 0, 0};
        LEDManager::colorOf(Identity::colorOf((uint8_t)i), rgb);
        char color[8];
        snprintf(color, sizeof(color), "#%02x%02x%02x", rgb.red, rgb.green, rgb.blue);
        entry["color"] = color;
        entry["mac"] = mac;
        entry["alive"] = this->isAlive((uint8_t)i);
        entry["lastSeenMs"] = (uint32_t)((now - pod.lastSeenUs) / 1000);
        entry["effects"] = (pod.linkFeatures & LINK_FEATURE_EFFECTS) != 0;
        entry["hold"] = (pod.linkFeatures & LINK_FEATURE_HOLD) != 0;
        entry["toggle"] = (pod.linkFeatures & LINK_FEATURE_TOGGLE) != 0;
        if(pod.fwMajor != 0) {
            entry["firmware"] = String(pod.fwMajor) + "." + String(pod.fwMinor);
        }
        if(pod.batteryMv != 0) {
            JsonObject b = entry["battery"].to<JsonObject>();
            b["percent"] = Battery::percentOf(pod.batteryMv);
            b["mv"] = pod.batteryMv;
        }

        EspNowLink::LinkStats st;
        if(this->link.stats(pod.mac, st)) {
            JsonObject l = entry["link"].to<JsonObject>();
            l["txFrames"] = st.txFrames;
            l["txRetries"] = st.txRetries;
            l["txLost"] = st.txLost;
            l["rxFrames"] = st.rxFrames;
            l["rxDuplicates"] = st.rxDuplicates;
            l["ackUsLast"] = st.lastAckUs;
            l["ackUsAvg"] = st.avgAckUs;
            l["ackUsMax"] = st.maxAckUs;
        }
    }
}
