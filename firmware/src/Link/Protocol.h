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
 *                                ◄─── ARM (cmdSeq, mode, colours, start time [, waiting effect])
 *   PRESSED (cmdSeq, reaction µs) ──►
 *                                ◄─── RESET
 *                                ◄─── EFFECT (effect, start time)   only to pods with LINK_FEATURE_EFFECTS
 *   RELEASED (hold report) ─────────►                 CHARGE / RELEASE activations, LINK_FEATURE_HOLD
 *   PRESSED (owner, flipCount) ─────►                 TOGGLE activations, LINK_FEATURE_TOGGLE
 *
 * Program store sync (see StoreSync): PING and PONG carry the store generation and hash.
 * The pod with the older store reads the other pod's manifest and changed files with
 * SYNC_READ requests, one chunk at a time.
 *
 * Extensions keep VERSION (a new version would make older pods invisible). New fields are
 * appended at the end of a frame and frameSize() stays the size without them, so older
 * firmware accepts the longer frame and ignores the tail. A receiver checks the length
 * before it reads an appended field. Unknown message types are ignored by every version.
 * What a peripheral understands is announced in CLAIM_ACK (linkFeatures).
 *
 * Link protocol revision 2 (firmware 2.9) adds hold reporting (LINK_FEATURE_HOLD): PodMode
 * CHARGE / RELEASE, the RELEASED frame and the hold parameters appended to ARM.
 *
 * Link protocol revision 3 (firmware 2.10) adds toggle (LINK_FEATURE_TOGGLE): PodMode TOGGLE, the toggle
 * parameters appended to ARM and owner / flipCount appended to PRESSED.
 *
 *   SYNC_READ_REQ (path, offset) ───►
 *                                ◄─── SYNC_READ_RESP (offset, total, data)
 */
namespace Protocol {

    const uint8_t MAGIC = 0x52;     // 'R'
    const uint8_t VERSION = 1;          // frame header version, see "Extensions" above
    const uint8_t REVISION = 3;         // link protocol revision (reported as info.linkRevision)
    const uint8_t MAX_FRAME = 250;     // ESP-NOW limit

    enum class MsgType : uint8_t {
        HELLO = 1,
        CLAIM,
        CLAIM_ACK,
        PING,
        PONG,
        ARM,
        RESET,
        PRESSED,
        SYNC_READ_REQ,
        SYNC_READ_RESP,
        EFFECT,             // firmware >= 2.8, only sent to pods with LINK_FEATURE_EFFECTS
        RELEASED,           // firmware >= 2.9, peripheral -> central, hold report (LINK_FEATURE_HOLD)
    };

    // ClaimAck::linkFeatures (firmware >= 2.8; a shorter CLAIM_ACK means 0)
    const uint8_t LINK_FEATURE_EFFECTS = 0x01;     // EFFECT frames and the ARM waiting effect
    const uint8_t LINK_FEATURE_HOLD = 0x02;        // PodMode CHARGE / RELEASE, ARM hold parameters, RELEASED (firmware >= 2.9)
    const uint8_t LINK_FEATURE_TOGGLE = 0x04;      // PodMode TOGGLE, ARM toggle parameters, PRESSED owner / flipCount (firmware >= 2.10)

    enum class PodMode : uint8_t {
        HIT = 1,    // pod should be pressed
        AVOID = 2,  // pod must not be pressed
        CHARGE = 3, // hold to charge (charge block), needs LINK_FEATURE_HOLD
        RELEASE = 4,// hold, release is the event (release block), needs LINK_FEATURE_HOLD
        TOGGLE = 5, // every press flips the pod between two colours (toggle block), needs LINK_FEATURE_TOGGLE
    };

    enum class PressResult : uint8_t {
        HIT = 1,        // a HIT pod was pressed
        AVOID_HIT = 2,  // an AVOID pod was pressed
    };

    // Colour indices understood by LEDManager::setLEDColors(uint8_t)
    namespace Color {
        const uint8_t RED = 0;
        const uint8_t GREEN = 1;
        const uint8_t BLUE = 2;
        const uint8_t YELLOW = 3;
        const uint8_t MAGENTA = 4;
        const uint8_t CYAN = 5;
        const uint8_t WHITE = 6;
        const uint8_t OFF = 255;
    }

    // Ring effects played by LEDManager (see link-protocol.md §2.1)
    enum class EffectId : uint8_t {
        NONE = 0,           // no effect (EFFECT frame: stop, LEDs off)
        SOLID,              // color at brightness
        FILL,               // LEDs light one by one over durationMs
        DRAIN,              // LEDs go out one by one over durationMs
        DIM,                // brightness param -> brightness over durationMs
        COLOR_SHIFT,        // color -> color2 over durationMs
        TRAFFIC_LIGHT,      // green, yellow, red, one third of durationMs each
        BLINK,              // color / color2 alternating, periodMs per cycle
        PULSE,              // brightness -> 0 -> brightness, periodMs per cycle
        SPIN,               // segment of param LEDs, one revolution per periodMs
        LEVEL,              // gauge: param % of the ring (0..100)
        COUNT_              // number of ids, not an effect
    };

    const uint8_t EFFECT_FLAG_REVERSE = 0x01;      // fill / drain / spin / level run counter-clockwise
    const uint8_t EFFECT_FLAG_END_OFF = 0x02;      // LEDs off when durationMs has passed (else the end frame stays)

    // 12 bytes. Colours are colour indices (see Color), blends are computed on the pod.
    struct __attribute__((packed)) EffectDesc {
        EffectId effect;
        uint8_t color;          // main colour
        uint8_t color2;         // second colour: target of COLOR_SHIFT, background of the others (OFF = dark)
        uint8_t brightness;     // 0..255 (DIM: end brightness)
        uint32_t durationMs;    // timed effects: length; periodic effects: 0 = endless
        uint16_t periodMs;      // BLINK, PULSE, SPIN; 0 = 1000
        uint8_t param;          // SPIN: segment length (0 = 3), DIM: start brightness, LEVEL: percent
        uint8_t flags;          // EFFECT_FLAG_*
    };
    static_assert(sizeof(EffectDesc) == 12, "EffectDesc must stay 12 bytes");

    // HoldParams::flags
    const uint8_t HOLD_FLAG_ALLOW_HELD = 0x01;     // RELEASE: a hold that is active on activation counts
    const uint8_t HOLD_FLAG_SIGNAL = 0x02;         // RELEASE: switch colour after goDelayMs, measure the reaction
    const uint8_t HOLD_FLAG_ACCUMULATE = 0x04;     // CHARGE: releasing pauses / drains the charge instead of ending

    // Parameters of a CHARGE / RELEASE activation (36 bytes), see link-protocol.md §2.2
    struct __attribute__((packed)) HoldParams {
        uint8_t flags;          // HOLD_FLAG_*
        uint8_t heldColor;      // RELEASE: colour once the hold is detected
        uint8_t goColor;        // RELEASE signal: colour after the switch
        uint8_t reserved;
        uint32_t onsetMs;       // CHARGE: hold time before the charge starts (every hold)
        uint32_t maxMs;         // CHARGE: charging time (after the onset) for a full charge
        uint32_t decayMs;       // CHARGE accumulate: time to drain a full charge while released; 0 = keep
        uint32_t goDelayMs;     // RELEASE signal: hold start -> switch
        uint32_t limitMs;       // CHARGE accumulate: time limit since the activation; 0 = none
        EffectDesc effect;      // CHARGE: the charge, over maxMs. RELEASE: countdown at the hold start (trigger)
                                // or at the switch (signal); NONE = static heldColor / goColor
    };
    static_assert(sizeof(HoldParams) == 36, "HoldParams must stay 36 bytes");

    // Team owning a toggle pod (Pressed::owner, ToggleParams::startOwner). A is colorActive of ARM, B is colorAfter.
    const uint8_t OWNER_A = 0;
    const uint8_t OWNER_B = 1;
    const uint8_t OWNER_NONE = 2;      // unowned: the pod is dark until its first press, which makes it A

    // Parameters of a TOGGLE activation (4 bytes), see link-protocol.md §2.3
    struct __attribute__((packed)) ToggleParams {
        uint8_t startOwner;     // OWNER_*
        uint8_t reserved;
        uint16_t cooldownMs;    // minimum time between two flips of the pod
    };
    static_assert(sizeof(ToggleParams) == 4, "ToggleParams must stay 4 bytes");

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
        uint8_t linkFeatures;   // LINK_FEATURE_*, firmware >= 2.8 (appended)
    };

    // Program store state of the sender (for sync)
    struct __attribute__((packed)) StoreState {
        uint32_t generation;
        uint32_t hash;
    };

    // peripheral -> central. t1 = peripheral clock at transmission (µs)
    struct __attribute__((packed)) Ping {
        Header header;
        int64_t t1;
        StoreState store;
    };

    const uint8_t PONG_FLAG_SYNC_ALLOWED = 0x01;   // central is not running a game: sync may run

    // central -> peripheral. t2 = central clock at PING reception, t3 = central clock at transmission
    struct __attribute__((packed)) Pong {
        Header header;
        int64_t t1;
        int64_t t2;
        int64_t t3;
        StoreState store;
        uint8_t flags;
    };

    // central -> peripheral
    struct __attribute__((packed)) Arm {
        Header header;
        uint8_t cmdSeq;         // identifies this activation, echoed in PRESSED
        PodMode mode;
        uint8_t colorActive;    // colour while waiting for the press
        uint8_t colorAfter;     // colour after the press
        int64_t startAtUs;      // central clock; 0 = light up immediately
        EffectDesc waiting;     // appended, optional: played instead of colorActive while waiting for the press
        HoldParams hold;        // appended after waiting, only for PodMode CHARGE / RELEASE (waiting is then always present)
        ToggleParams toggle;    // appended after hold, only for PodMode TOGGLE (waiting and hold are then present, hold zeroed)
    };

    // central -> peripheral: play an effect on the ring. Does not change the activation state.
    struct __attribute__((packed)) Effect {
        Header header;
        EffectDesc effect;
        int64_t startAtUs;      // central clock; 0 = now. A late frame joins the running animation
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
        uint8_t owner;          // appended, TOGGLE only: owner after this press (OWNER_*), absolute
        uint16_t flipCount;     // appended, TOGGLE only: flips since the ARM, 1 for the first
    };

    const uint8_t RELEASED_FLAG_FALSE_START = 0x01;    // RELEASE signal: released before the switch
    const uint8_t RELEASED_FLAG_FULL = 0x02;           // CHARGE: full charge reached (reported at that moment, not at the release)
    const uint8_t RELEASED_FLAG_LIMIT = 0x04;          // CHARGE accumulate: time limit reached, chargeMs is final
    const uint8_t RELEASED_FLAG_EARLY = 0x08;          // CHARGE release mode: released before the onset

    // peripheral -> central: end of a hold (CHARGE / RELEASE activations), measured on the peripheral
    struct __attribute__((packed)) Released {
        Header header;
        uint8_t podId;
        uint8_t cmdSeq;
        uint8_t flags;          // RELEASED_FLAG_*
        uint32_t heldMs;        // hold time (CHARGE accumulate: all holds together)
        int32_t reactionUs;     // RELEASE signal: switch -> release; else 0
        uint32_t chargeMs;      // CHARGE: charge at the end (0 .. maxMs); else 0
    };

    // Path of the virtual manifest file in SYNC_READ requests
    const char* const MANIFEST_PATH = "@manifest";
    const uint8_t SYNC_PATH_LEN = 32;
    const uint8_t SYNC_CHUNK = 200;

    // either direction: read part of a store file (or MANIFEST_PATH) of the receiver
    struct __attribute__((packed)) SyncReadReq {
        Header header;
        uint8_t reqId;
        uint32_t offset;
        char path[SYNC_PATH_LEN];   // null terminated
    };

    enum class SyncStatus : uint8_t { OK = 0, NOT_FOUND = 1, BAD_OFFSET = 2 };

    struct __attribute__((packed)) SyncReadResp {
        Header header;
        uint8_t reqId;
        SyncStatus status;
        uint32_t offset;
        uint32_t total;             // file size
        uint8_t len;                // bytes in data
        uint8_t data[SYNC_CHUNK];   // only len bytes are sent
    };

    static_assert(sizeof(Pong) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(SyncReadResp) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Arm) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Pressed) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Effect) <= MAX_FRAME, "frame too large");
    static_assert(sizeof(Released) <= MAX_FRAME, "frame too large");

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

    // Minimum size a frame of the given type must have (without appended optional fields)
    inline size_t frameSize(MsgType type) {
        switch(type) {
            case MsgType::HELLO: return sizeof(Hello);
            case MsgType::CLAIM: return sizeof(Claim);
            case MsgType::CLAIM_ACK: return offsetof(ClaimAck, linkFeatures);
            case MsgType::PING: return sizeof(Ping);
            case MsgType::PONG: return sizeof(Pong);
            case MsgType::ARM: return offsetof(Arm, waiting);       // waiting, hold and toggle are appended
            case MsgType::RESET: return sizeof(Reset);
            case MsgType::PRESSED: return offsetof(Pressed, owner);   // owner and flipCount are appended
            case MsgType::SYNC_READ_REQ: return sizeof(SyncReadReq);
            case MsgType::SYNC_READ_RESP: return offsetof(SyncReadResp, data);   // + len bytes
            case MsgType::EFFECT: return sizeof(Effect);
            case MsgType::RELEASED: return sizeof(Released);
        }
        return 0;
    }
}
