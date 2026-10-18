#pragma once

#include <stdint.h>
#include <stddef.h>

/**
 * Wire format between pods (ESP-NOW frames). All fields little endian, structs packed.
 *
 * Every frame starts with a Header. Frames with a different magic/version are ignored,
 * so pods with incompatible firmware simply do not see each other.
 *
 *   Peripheral                         Central
 *   HELLO (broadcast, unclaimed) ───►
 *                                ◄─── CLAIM (setId, podId)
 *   CLAIM_ACK ──────────────────────►
 *   PING (every 200 ms, t1) ────────►                 heartbeat + clock sync
 *                                ◄─── PONG (t1, t2, t3)
 *                                ◄─── ARM (cmdSeq, mode, colours, start time)
 *   PRESSED (cmdSeq, reaction µs) ──►
 *                                ◄─── RESET
 */
namespace Protocol {

    const uint8_t MAGIC = 0x52;     // 'R'
    const uint8_t VERSION = 1;
    const uint8_t MAX_FRAME = 64;

    enum class MsgType : uint8_t {
        HELLO = 1,
        CLAIM,
        CLAIM_ACK,
        PING,
        PONG,
        ARM,
        RESET,
        PRESSED,
    };

    enum class PodMode : uint8_t {
        HIT = 1,    // pod should be pressed
        AVOID = 2,  // pod must not be pressed
    };

    enum class PressResult : uint8_t {
        HIT = 1,        // a HIT pod was pressed
        AVOID_HIT = 2,  // an AVOID pod was pressed
    };

    // Colour indices understood by LEDManager::setLEDColors(uint8_t)
    namespace Color {
        const uint8_t RED = 0;
        const uint8_t GREEN = 1;
        const uint8_t OFF = 255;
    }

    struct __attribute__((packed)) Header {
        uint8_t magic;
        uint8_t version;
        MsgType type;
        uint8_t seq;        // per sender, set by the link layer, used to drop retransmitted duplicates
        uint32_t setId;     // set the sender belongs to (0 = unpaired peripheral)
    };

    // peripheral -> broadcast, while not claimed
    struct __attribute__((packed)) Hello {
        Header header;
        uint8_t fwMajor;
        uint8_t fwMinor;
    };

    // central -> peripheral
    struct __attribute__((packed)) Claim {
        Header header;
        uint8_t podId;
    };

    // peripheral -> central
    struct __attribute__((packed)) ClaimAck {
        Header header;
        uint8_t podId;
    };

    // peripheral -> central. t1 = peripheral clock at transmission (µs)
    struct __attribute__((packed)) Ping {
        Header header;
        int64_t t1;
    };

    // central -> peripheral. t2 = central clock at PING reception, t3 = central clock at transmission
    struct __attribute__((packed)) Pong {
        Header header;
        int64_t t1;
        int64_t t2;
        int64_t t3;
    };

    // central -> peripheral
    struct __attribute__((packed)) Arm {
        Header header;
        uint8_t cmdSeq;         // identifies this activation, echoed in PRESSED
        PodMode mode;
        uint8_t colorActive;    // colour while waiting for the press
        uint8_t colorAfter;     // colour after the press
        int64_t startAtUs;      // central clock; 0 = light up immediately
    };

    // central -> peripheral
    struct __attribute__((packed)) Reset {
        Header header;
    };

    // peripheral -> central
    struct __attribute__((packed)) Pressed {
        Header header;
        uint8_t podId;
        uint8_t cmdSeq;
        PressResult result;
        int32_t reactionUs;     // LED on -> button press, measured on the peripheral
    };

    static_assert(sizeof(Pong) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Arm) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Pressed) <= MAX_FRAME, "frame too large");

    inline void fillHeader(Header& header, MsgType type, uint32_t setId) {
        header.magic = MAGIC;
        header.version = VERSION;
        header.type = type;
        header.seq = 0;
        header.setId = setId;
    }

    // Returns the header if the frame is a valid frame of this protocol version, else nullptr
    inline const Header* parseHeader(const uint8_t* data, size_t len) {
        if(len < sizeof(Header)) {
            return nullptr;
        }
        const Header* header = reinterpret_cast<const Header*>(data);
        if(header->magic != MAGIC || header->version != VERSION) {
            return nullptr;
        }
        return header;
    }

    // Size a frame of the given type must have
    inline size_t frameSize(MsgType type) {
        switch(type) {
            case MsgType::HELLO: return sizeof(Hello);
            case MsgType::CLAIM: return sizeof(Claim);
            case MsgType::CLAIM_ACK: return sizeof(ClaimAck);
            case MsgType::PING: return sizeof(Ping);
            case MsgType::PONG: return sizeof(Pong);
            case MsgType::ARM: return sizeof(Arm);
            case MsgType::RESET: return sizeof(Reset);
            case MsgType::PRESSED: return sizeof(Pressed);
        }
        return 0;
    }
}
