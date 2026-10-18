#include <esp_now.h>
#include <esp_wifi.h>
#include <WiFi.h>
#include "EspNowLink.h"

static const char* TAG = "ESPNOW";
static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

EspNowLink& EspNowLink::get() {
    static EspNowLink link;
    return link;
}

bool EspNowLink::begin(uint8_t channel) {
    if(this->started) {
        return true;
    }

    this->rxQueue = xQueueCreate(32, sizeof(RxFrame));
    this->txStatusQueue = xQueueCreate(16, sizeof(TxStatus));
    this->seq = (uint8_t)esp_random();

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_ps(WIFI_PS_NONE);      // radio always on: lowest latency
    if(esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) != ESP_OK) {
        ESP_LOGE(TAG, "cannot set channel %u", channel);
        return false;
    }

    if(esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "esp_now_init failed");
        return false;
    }
    esp_now_register_recv_cb(&EspNowLink::onReceive);
    esp_now_register_send_cb(&EspNowLink::onSent);

    esp_now_peer_info_t broadcastPeer = {};
    memcpy(broadcastPeer.peer_addr, BROADCAST_MAC, 6);
    broadcastPeer.channel = 0;          // current channel
    broadcastPeer.ifidx = WIFI_IF_STA;
    esp_now_add_peer(&broadcastPeer);

    ESP_LOGI(TAG, "ESP-NOW started on channel %u, MAC %s", channel, WiFi.macAddress().c_str());
    this->started = true;
    return true;
}

void EspNowLink::onReceive(const uint8_t* mac, const uint8_t* data, int len) {
    EspNowLink& link = EspNowLink::get();
    if(len <= 0 || len > Protocol::MAX_FRAME || link.rxQueue == nullptr) {
        return;
    }
    RxFrame frame;
    frame.rxUs = esp_timer_get_time();
    memcpy(frame.mac, mac, 6);
    frame.len = (uint8_t)len;
    memcpy(frame.data, data, len);
    xQueueSend(link.rxQueue, &frame, 0);
}

void EspNowLink::onSent(const uint8_t* mac, esp_now_send_status_t status) {
    EspNowLink& link = EspNowLink::get();
    if(mac == nullptr || link.txStatusQueue == nullptr || EspNowLink::sameMac(mac, BROADCAST_MAC)) {
        return;
    }
    TxStatus result;
    memcpy(result.mac, mac, 6);
    result.ok = status == ESP_NOW_SEND_SUCCESS;
    xQueueSend(link.txStatusQueue, &result, 0);
}

EspNowLink::Peer* EspNowLink::findPeer(const uint8_t* mac) {
    for(Peer& peer : this->peers) {
        if(EspNowLink::sameMac(peer.mac, mac)) {
            return &peer;
        }
    }
    return nullptr;
}

EspNowLink::Peer* EspNowLink::addPeer(const uint8_t* mac) {
    Peer* existing = this->findPeer(mac);
    if(existing != nullptr) {
        return existing;
    }

    esp_now_peer_info_t info = {};
    memcpy(info.peer_addr, mac, 6);
    info.channel = 0;
    info.ifidx = WIFI_IF_STA;
    esp_err_t err = esp_now_add_peer(&info);
    if(err != ESP_OK && err != ESP_ERR_ESPNOW_EXIST) {
        ESP_LOGE(TAG, "add peer failed: %d", err);
        return nullptr;
    }

    this->peers.push_back(Peer());
    Peer& peer = this->peers.back();
    memcpy(peer.mac, mac, 6);
    return &peer;
}

bool EspNowLink::send(const uint8_t* mac, const void* frame, uint8_t len,
                      uint8_t retries, int8_t stampOffset, bool urgent) {
    if(!this->started || len > Protocol::MAX_FRAME || len < sizeof(Protocol::Header)) {
        return false;
    }
    Peer* peer = this->addPeer(mac);
    if(peer == nullptr) {
        return false;
    }
    if(peer->queue.size() >= MAX_QUEUED_PER_PEER) {
        ESP_LOGW(TAG, "tx queue full, dropping oldest frame");
        // never drop the frame that is on air
        peer->queue.erase(peer->queue.begin() + (peer->inFlight ? 1 : 0));
    }

    Pending pending;
    memcpy(pending.data, frame, len);
    pending.len = len;
    pending.retriesLeft = retries;
    pending.stampOffset = stampOffset;
    pending.urgent = urgent;
    reinterpret_cast<Protocol::Header*>(pending.data)->seq = this->nextSeq();

    if(urgent) {
        // behind the frame on air and behind earlier urgent frames, ahead of the others
        auto pos = peer->queue.begin() + (peer->inFlight && !peer->queue.empty() ? 1 : 0);
        while(pos != peer->queue.end() && pos->urgent) {
            ++pos;
        }
        peer->queue.insert(pos, pending);
    } else {
        peer->queue.push_back(pending);
    }

    if(!peer->inFlight) {
        this->transmitHead(*peer);
    }
    return true;
}

void EspNowLink::transmitHead(Peer& peer) {
    if(peer.queue.empty()) {
        peer.inFlight = false;
        return;
    }
    Pending& head = peer.queue.front();
    if(head.stampOffset >= 0) {
        int64_t now = esp_timer_get_time();
        memcpy(head.data + head.stampOffset, &now, sizeof(now));
    }

    peer.sentAtUs = esp_timer_get_time();
    if(esp_now_send(peer.mac, head.data, head.len) == ESP_OK) {
        peer.inFlight = true;
    } else {
        // driver busy / out of buffers: try again on the next service()
        peer.inFlight = false;
    }
}

bool EspNowLink::broadcast(const void* frame, uint8_t len) {
    if(!this->started || len > Protocol::MAX_FRAME || len < sizeof(Protocol::Header)) {
        return false;
    }
    uint8_t data[Protocol::MAX_FRAME];
    memcpy(data, frame, len);
    reinterpret_cast<Protocol::Header*>(data)->seq = this->nextSeq();
    return esp_now_send(BROADCAST_MAC, data, len) == ESP_OK;
}

void EspNowLink::service() {
    if(!this->started) {
        return;
    }

    TxStatus status;
    while(xQueueReceive(this->txStatusQueue, &status, 0) == pdTRUE) {
        Peer* peer = this->findPeer(status.mac);
        if(peer == nullptr || !peer->inFlight || peer->queue.empty()) {
            continue;
        }
        peer->inFlight = false;
        Pending& head = peer->queue.front();
        if(status.ok || head.retriesLeft == 0) {
            if(!status.ok) {
                ESP_LOGW(TAG, "frame type %u lost", (unsigned)head.data[2]);
            }
            peer->queue.pop_front();
        } else {
            head.retriesLeft--;
        }
        this->transmitHead(*peer);
    }

    int64_t now = esp_timer_get_time();
    for(Peer& peer : this->peers) {
        if(peer.inFlight && now - peer.sentAtUs > TX_TIMEOUT_US) {
            // no send callback: treat as failure
            peer.inFlight = false;
            if(!peer.queue.empty()) {
                if(peer.queue.front().retriesLeft == 0) {
                    peer.queue.pop_front();
                } else {
                    peer.queue.front().retriesLeft--;
                }
            }
        }
        if(!peer.inFlight && !peer.queue.empty()) {
            this->transmitHead(peer);
        }
    }
}

bool EspNowLink::receive(RxFrame& frame) {
    if(!this->started) {
        return false;
    }
    while(xQueueReceive(this->rxQueue, &frame, 0) == pdTRUE) {
        const Protocol::Header* header = Protocol::parseHeader(frame.data, frame.len);
        if(header == nullptr) {
            continue;   // not ours or other protocol version
        }
        Peer* peer = this->findPeer(frame.mac);
        if(peer != nullptr) {
            if(peer->hasRxSeq && peer->lastRxSeq == header->seq) {
                continue;   // retransmission of a frame we already have
            }
            peer->hasRxSeq = true;
            peer->lastRxSeq = header->seq;
        }
        return true;
    }
    return false;
}
