#include <unity.h>
#include <string.h>
#include "Link/Protocol.h"
#include "Link/ClockSync.h"

using namespace Protocol;

void setUp() {}

void tearDown() {}

// Packs a frame the way the link layer sends it and parses it back.
void test_pressed_frame_round_trip() {
    Pressed out{};
    fillHeader(out.header, MsgType::PRESSED, 0x12345678);
    out.podId = 3;
    out.cmdSeq = 200;
    out.result = PressResult::AVOID_HIT;
    out.reactionUs = -1500;
    out.owner = OWNER_B;
    out.flipCount = 7;

    uint8_t buffer[MAX_FRAME];
    memcpy(buffer, &out, sizeof(out));
    size_t len = sizeof(out);

    const Header* header = parseHeader(buffer, len);
    TEST_ASSERT_NOT_NULL(header);
    TEST_ASSERT_TRUE(header->type == MsgType::PRESSED);
    TEST_ASSERT_EQUAL_UINT32(0x12345678, header->setId);
    TEST_ASSERT_TRUE(len >= frameSize(header->type));

    const Pressed* in = reinterpret_cast<const Pressed*>(buffer);
    TEST_ASSERT_EQUAL_UINT8(3, in->podId);
    TEST_ASSERT_EQUAL_UINT8(200, in->cmdSeq);
    TEST_ASSERT_TRUE(in->result == PressResult::AVOID_HIT);
    TEST_ASSERT_EQUAL_INT32(-1500, in->reactionUs);
    TEST_ASSERT_EQUAL_UINT8(OWNER_B, in->owner);
    TEST_ASSERT_EQUAL_UINT16(7, in->flipCount);
}

// Older firmware sends PRESSED without the appended toggle fields; the frame is still valid.
void test_short_frame_with_appended_fields_is_accepted() {
    Pressed out{};
    fillHeader(out.header, MsgType::PRESSED, 1);
    uint8_t buffer[sizeof(Pressed)];
    memcpy(buffer, &out, sizeof(out));

    size_t shortLen = frameSize(MsgType::PRESSED);
    TEST_ASSERT_TRUE(shortLen < sizeof(Pressed));
    TEST_ASSERT_NOT_NULL(parseHeader(buffer, shortLen));
    TEST_ASSERT_TRUE(shortLen >= frameSize(MsgType::PRESSED));
}

void test_parse_header_rejects_foreign_frames() {
    uint8_t frame[sizeof(Reset)];
    Reset reset{};
    fillHeader(reset.header, MsgType::RESET, 9);
    memcpy(frame, &reset, sizeof(reset));
    TEST_ASSERT_NOT_NULL(parseHeader(frame, sizeof(frame)));

    frame[0] = 0x00;   // magic
    TEST_ASSERT_NULL(parseHeader(frame, sizeof(frame)));
    frame[0] = MAGIC;
    frame[1] = VERSION + 1;   // a new version must not be seen by this firmware
    TEST_ASSERT_NULL(parseHeader(frame, sizeof(frame)));
    TEST_ASSERT_NULL(parseHeader(frame, sizeof(Header) - 1));
}

void test_effect_and_hold_structs_keep_wire_size() {
    TEST_ASSERT_EQUAL(12, sizeof(EffectDesc));
    TEST_ASSERT_EQUAL(36, sizeof(HoldParams));
    TEST_ASSERT_EQUAL(4, sizeof(ToggleParams));
    TEST_ASSERT_EQUAL(offsetof(Arm, waiting), frameSize(MsgType::ARM));
    TEST_ASSERT_TRUE(frameSize(MsgType::ARM) < sizeof(Arm));
    TEST_ASSERT_TRUE(sizeof(Arm) <= MAX_FRAME);
}

void test_ping_pong_timestamps_round_trip() {
    Pong pong{};
    fillHeader(pong.header, MsgType::PONG, 5);
    pong.t1 = -10;
    pong.t2 = 1234567890123LL;
    pong.t3 = 1234567890200LL;
    pong.store = {42, 0xDEADBEEF};
    pong.flags = PONG_FLAG_SYNC_ALLOWED | PONG_FLAG_IDENTIFY;

    uint8_t buffer[MAX_FRAME];
    memcpy(buffer, &pong, sizeof(pong));
    const Pong* in = reinterpret_cast<const Pong*>(buffer);
    TEST_ASSERT_EQUAL_INT64(-10, in->t1);
    TEST_ASSERT_EQUAL_INT64(1234567890123LL, in->t2);
    TEST_ASSERT_EQUAL_INT64(1234567890200LL, in->t3);
    TEST_ASSERT_EQUAL_UINT32(42, in->store.generation);
    TEST_ASSERT_EQUAL_UINT32(0xDEADBEEF, in->store.hash);
    TEST_ASSERT_EQUAL_UINT8(3, in->flags);
}

// Central clock = local clock + 1000 µs, symmetric path of 5 µs each way (sample 1, delay 10).
// The second sample is slower (delay 50, offset 1175), so the first one must win.
void test_clock_sync_picks_sample_with_smallest_delay() {
    ClockSync sync;
    TEST_ASSERT_FALSE(sync.isSynced());
    sync.addSample(0, 1005, 1005, 10);
    sync.addSample(100, 1300, 1300, 150);
    TEST_ASSERT_TRUE(sync.isSynced());
    TEST_ASSERT_EQUAL_INT64(1000, sync.offset());
    TEST_ASSERT_EQUAL_INT64(5000, sync.toLocal(6000));

    sync.clear();
    TEST_ASSERT_FALSE(sync.isSynced());
}

// Firmware update frames (rev. 6): the layouts are frozen (link-protocol.md section 7), and a PING from an older pod is shorter
void test_ota_frames_keep_their_layout() {
    TEST_ASSERT_EQUAL(8 + 4 + 32 + 1 + OTA_VERSION_LEN, sizeof(OtaOffer));
    TEST_ASSERT_EQUAL(8 + 8, sizeof(OtaActivate));
    TEST_ASSERT_EQUAL(8 + 2 + OTA_CHUNK_DATA, sizeof(OtaChunk));
    TEST_ASSERT_EQUAL(10, offsetof(OtaChunk, data));
    TEST_ASSERT_EQUAL(sizeof(OtaOffer), frameSize(MsgType::OTA_OFFER));
    TEST_ASSERT_EQUAL(sizeof(OtaActivate), frameSize(MsgType::OTA_ACTIVATE));
    TEST_ASSERT_EQUAL(11, frameSize(MsgType::OTA_CHUNK));          // header, index and at least one data byte
    TEST_ASSERT_EQUAL(6, REVISION);
    TEST_ASSERT_EQUAL(0x10, LINK_FEATURE_OTA);
}

void test_ping_with_ota_fields_is_an_extension() {
    TEST_ASSERT_EQUAL(offsetof(Ping, batteryMv), frameSize(MsgType::PING));     // older centrals still accept it
    TEST_ASSERT_EQUAL(offsetof(Ping, otaState) + 2, sizeof(Ping));
    TEST_ASSERT_TRUE(offsetof(Ping, otaState) < sizeof(Ping));                  // a PING of firmware 2.13 ... 2.19 ends here: no ota state
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_pressed_frame_round_trip);
    RUN_TEST(test_short_frame_with_appended_fields_is_accepted);
    RUN_TEST(test_parse_header_rejects_foreign_frames);
    RUN_TEST(test_effect_and_hold_structs_keep_wire_size);
    RUN_TEST(test_ping_pong_timestamps_round_trip);
    RUN_TEST(test_clock_sync_picks_sample_with_smallest_delay);
    RUN_TEST(test_ota_frames_keep_their_layout);
    RUN_TEST(test_ping_with_ota_fields_is_an_extension);
    return UNITY_END();
}
