#include "PodNetwork.h"
#include "_Definitions.h"

using namespace Protocol;

static const char* TAG = "PODNET";

bool PodNetwork::begin(uint32_t setId) {
    this->setId = setId;
    return this->link.begin(ESPNOW_CHANNEL);
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

        switch(header->type) {
            case MsgType::PING:
                this->handlePing(frame, podId);
                break;
            case MsgType::PRESSED:
                this->handlePressed(frame, podId);
                break;
            default:
                break;
        }
    }
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

    int16_t known = this->findPod(frame.mac);
    if(known >= 0) {
        this->pods[known].lastSeenUs = esp_timer_get_time();
        return;
    }

    if(!this->claimPending || !EspNowLink::sameMac(this->claimMac, frame.mac) || ack->podId != this->pods.size()) {
        return;
    }
    this->claimPending = false;

    Pod pod;
    memcpy(pod.mac, frame.mac, 6);
    pod.lastSeenUs = esp_timer_get_time();
    this->pods.push_back(pod);
    ESP_LOGI(TAG, "pod %u joined", ack->podId);
}

void PodNetwork::handlePing(const RxFrame& frame, int16_t podId) {
    const Ping* ping = reinterpret_cast<const Ping*>(frame.data);

    Pong pong;
    fillHeader(pong.header, MsgType::PONG, this->setId);
    pong.t1 = ping->t1;
    pong.t2 = frame.rxUs;
    pong.t3 = 0;    // stamped by the link when the frame goes to the radio
    this->link.send(this->pods[podId].mac, &pong, sizeof(pong), 0, (int8_t)offsetof(Pong, t3));
}

void PodNetwork::handlePressed(const RxFrame& frame, int16_t podId) {
    const Pressed* pressed = reinterpret_cast<const Pressed*>(frame.data);

    PodEvent event;
    event.podId = (uint8_t)podId;
    event.cmdSeq = pressed->cmdSeq;
    event.result = pressed->result;
    event.reactionUs = pressed->reactionUs;
    event.rxTimeUs = frame.rxUs;
    this->events.push_back(event);
}

uint8_t PodNetwork::arm(uint8_t podId, const ArmCommand& command) {
    if(podId >= this->pods.size()) {
        return 0;
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
    this->link.send(pod.mac, &arm, sizeof(arm), 5, -1, true);
    return pod.cmdSeq;
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

