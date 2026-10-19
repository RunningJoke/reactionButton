#pragma once

#include <Arduino.h>
#include <deque>
#include <vector>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <esp_now.h>
#include "Link/Protocol.h"

struct RxFrame {
    uint8_t mac[6];
    uint8_t len;
    int64_t rxUs;       // esp_timer time when the frame arrived (taken in the WiFi task)
    uint8_t data[Protocol::MAX_FRAME];
};

/**
 * ESP-NOW transport.
 *
 * - Unicast frames to the same peer are sent one at a time and in order. A frame that is
 *   not acknowledged by the receiver's radio is retried. This keeps e.g. RESET before ARM.
 * - The link sets Header::seq. Retransmissions keep their seq, so receive() can drop
 *   duplicates (a frame arrived, but its acknowledgement got lost).
 * - stampOffset: position of an int64 in the frame that is filled with the esp_timer time
 *   right before the frame goes to the radio (clock sync timestamps).
 *
 * The ESP-NOW callbacks run in the WiFi task; they only copy into FreeRTOS queues.
 * Everything else runs in the caller's task (main loop).
 */
class EspNowLink {
    public:
        static EspNowLink& get();

        bool begin(uint8_t channel);

        // Queue a unicast frame. urgent frames skip ahead of queued (not yet sent) frames.
        bool send(const uint8_t* mac, const void* frame, uint8_t len,
                  uint8_t retries = 3, int8_t stampOffset = -1, bool urgent = false);

        // Unacknowledged broadcast to everybody on the channel
        bool broadcast(const void* frame, uint8_t len);

        // Next received frame; duplicates of the previous frame of the same sender are dropped
        bool receive(RxFrame& frame);

        // Handles send results and retries. Call once per loop pass.
        void service();

        static bool sameMac(const uint8_t* a, const uint8_t* b) { return memcmp(a, b, 6) == 0; }

        bool isStarted() const { return this->started; }

        // Per-peer statistics (for status / link tests)
        struct LinkStats {
            uint32_t txFrames = 0;      // frames acknowledged by the receiver's radio
            uint32_t txRetries = 0;     // failed attempts that were retried
            uint32_t txLost = 0;        // frames given up after all retries
            uint32_t rxFrames = 0;
            uint32_t rxDuplicates = 0;  // retransmissions dropped
            uint32_t lastAckUs = 0;     // send -> acknowledgement of the last frame
            uint32_t avgAckUs = 0;      // moving average (1/8)
            uint32_t maxAckUs = 0;
        };
        bool stats(const uint8_t* mac, LinkStats& out) const;
        void resetStats();

    private:
        struct Pending {
            uint8_t data[Protocol::MAX_FRAME];
            uint8_t len;
            uint8_t retriesLeft;
            int8_t stampOffset;
            bool urgent;
        };

        struct Peer {
            uint8_t mac[6];
            std::deque<Pending> queue;
            bool inFlight = false;
            int64_t sentAtUs = 0;
            bool hasRxSeq = false;
            uint8_t lastRxSeq = 0;
            LinkStats stats;
        };

        struct TxStatus {
            uint8_t mac[6];
            bool ok;
            int64_t atUs;       // when the send callback ran
        };

        static const uint8_t MAX_QUEUED_PER_PEER = 8;
        static const int64_t TX_TIMEOUT_US = 100000;

        EspNowLink() {}

        Peer* findPeer(const uint8_t* mac);
        const Peer* findPeer(const uint8_t* mac) const;
        Peer* addPeer(const uint8_t* mac);
        void transmitHead(Peer& peer);
        uint8_t nextSeq() { return this->seq++; }

        static void onReceive(const uint8_t* mac, const uint8_t* data, int len);
        static void onSent(const uint8_t* mac, esp_now_send_status_t status);

        std::vector<Peer> peers;
        QueueHandle_t rxQueue = nullptr;
        QueueHandle_t txStatusQueue = nullptr;
        uint8_t seq = 0;
        bool started = false;
};
