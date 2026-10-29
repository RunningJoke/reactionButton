#include "PodNetwork.h"
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "LEDManager/Identity.h"

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
        this->sendClaim(frame.mac, (uint8_t)known);
        return;
    }

    if(!this->acceptNew || this->pods.size() >= this->maxPods || this->claimPending) {
        return;
    }

    this->claimPending = true;
    memcpy(this->claimMac, frame.mac, 6);
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
    pong.flags = (this->syncAllowed ? PONG_FLAG_SYNC_ALLOWED : 0) | (this->identify ? PONG_FLAG_IDENTIFY : 0);
    this->link.send(this->pods[podId].mac, &pong, sizeof(pong), 0, (int8_t)offsetof(Pong, t3));

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
