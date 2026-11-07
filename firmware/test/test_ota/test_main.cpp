#include <unity.h>
#include <stdlib.h>
#include <initializer_list>
#include <strings.h>
#include "Ota/OtaRules.h"
#include "Ota/OtaBitmap.h"

using namespace OtaRules;

void setUp() {}
void tearDown() {}

void test_write_must_continue_at_received() {
    TEST_ASSERT_EQUAL(WriteCheck::OK, checkWrite(State::RECEIVING, 0, 1000, 0, 100));
    TEST_ASSERT_EQUAL(WriteCheck::OK, checkWrite(State::RECEIVING, 100, 1000, 100, 900));
    TEST_ASSERT_EQUAL(WriteCheck::BAD_OFFSET, checkWrite(State::RECEIVING, 100, 1000, 200, 100));     // gap
    TEST_ASSERT_EQUAL(WriteCheck::BAD_OFFSET, checkWrite(State::RECEIVING, 100, 1000, 0, 100));       // repeat
}

void test_write_cannot_pass_the_announced_size() {
    TEST_ASSERT_EQUAL(WriteCheck::TOO_LARGE, checkWrite(State::RECEIVING, 900, 1000, 900, 101));
    TEST_ASSERT_EQUAL(WriteCheck::OK, checkWrite(State::RECEIVING, 900, 1000, 900, 100));
    TEST_ASSERT_EQUAL(WriteCheck::TOO_LARGE, checkWrite(State::RECEIVING, 0xFFFFFF00u, 0xFFFFFFFFu, 0xFFFFFF00u, 0x200));  // no overflow
}

void test_write_needs_a_receiving_update_and_data() {
    TEST_ASSERT_EQUAL(WriteCheck::NOT_RECEIVING, checkWrite(State::IDLE, 0, 1000, 0, 10));
    TEST_ASSERT_EQUAL(WriteCheck::NOT_RECEIVING, checkWrite(State::READY, 1000, 1000, 1000, 10));
    TEST_ASSERT_EQUAL(WriteCheck::NOT_RECEIVING, checkWrite(State::FAILED, 0, 1000, 0, 10));
    TEST_ASSERT_EQUAL(WriteCheck::EMPTY, checkWrite(State::RECEIVING, 0, 1000, 0, 0));
}

void test_sha256_text() {
    const char* good = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    TEST_ASSERT_TRUE(isSha256Hex(good));
    TEST_ASSERT_FALSE(isSha256Hex(nullptr));
    TEST_ASSERT_FALSE(isSha256Hex("e3b0"));
    TEST_ASSERT_FALSE(isSha256Hex("g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));

    uint8_t digest[32];
    for(int i = 0; i < 32; i++) {
        char pair[3] = {good[2 * i], good[2 * i + 1], 0};
        digest[i] = (uint8_t)strtoul(pair, nullptr, 16);
    }
    TEST_ASSERT_TRUE(hexMatches(good, digest));
    TEST_ASSERT_TRUE(hexMatches("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855", digest));
    digest[31] ^= 1;
    TEST_ASSERT_FALSE(hexMatches(good, digest));
}

void test_begin_resumes_only_the_same_open_image() {
    const char* a = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const char* b = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856";
    TEST_ASSERT_TRUE(resumes(State::RECEIVING, 5000, a, 5000, a));
    TEST_ASSERT_TRUE(resumes(State::READY, 5000, a, 5000, a));
    TEST_ASSERT_FALSE(resumes(State::RECEIVING, 5000, a, 5001, a));
    TEST_ASSERT_FALSE(resumes(State::RECEIVING, 5000, a, 5000, b));
    TEST_ASSERT_FALSE(resumes(State::IDLE, 5000, a, 5000, a));
    TEST_ASSERT_FALSE(resumes(State::FAILED, 5000, a, 5000, a));
}

void test_battery_and_progress_and_timeout() {
    TEST_ASSERT_TRUE(batteryAllows(false, 0));      // no reading: allowed
    TEST_ASSERT_TRUE(batteryAllows(true, 30));
    TEST_ASSERT_FALSE(batteryAllows(true, 29));
    TEST_ASSERT_EQUAL(0, percent(0, 0));
    TEST_ASSERT_EQUAL(50, percent(500, 1000));
    TEST_ASSERT_EQUAL(100, percent(1095344, 1095344));
    TEST_ASSERT_FALSE(expired(TIMEOUT_MS - 1, 0));
    TEST_ASSERT_TRUE(expired(TIMEOUT_MS, 0));
    TEST_ASSERT_TRUE(expired(5, 0xFFFFFFFFu - TIMEOUT_MS + 5));     // millis() wrapped
}

void test_state_names_and_progress() {
    TEST_ASSERT_EQUAL_STRING("receiving", stateName(State::RECEIVING));
    TEST_ASSERT_TRUE(inProgress(State::READY));
    TEST_ASSERT_FALSE(inProgress(State::FAILED));
    TEST_ASSERT_FALSE(inProgress(State::IDLE));
}

void test_chunk_arithmetic() {
    TEST_ASSERT_EQUAL(0, OtaBitmap::chunkCount(0));
    TEST_ASSERT_EQUAL(1, OtaBitmap::chunkCount(1));
    TEST_ASSERT_EQUAL(1, OtaBitmap::chunkCount(200));
    TEST_ASSERT_EQUAL(2, OtaBitmap::chunkCount(201));
    TEST_ASSERT_EQUAL(5477, OtaBitmap::chunkCount(1095344));
    TEST_ASSERT_EQUAL(1095200, OtaBitmap::chunkOffset(5476));
    TEST_ASSERT_EQUAL(144, OtaBitmap::chunkLength(5476, 1095344));      // the short last chunk
    TEST_ASSERT_EQUAL(200, OtaBitmap::chunkLength(5475, 1095344));
    TEST_ASSERT_EQUAL(0, OtaBitmap::chunkLength(5477, 1095344));        // past the end
    // a full slot (1792 KB) fits
    TEST_ASSERT_TRUE(OtaBitmap::chunkCount(0x1C0000) <= OtaBitmap::MAX_CHUNKS);
}

void test_bitmap_counts_each_chunk_once() {
    OtaBitmap bitmap;
    TEST_ASSERT_TRUE(bitmap.reset(1000));          // 5 chunks
    TEST_ASSERT_EQUAL(5, bitmap.chunks());
    TEST_ASSERT_FALSE(bitmap.complete());
    TEST_ASSERT_TRUE(bitmap.set(3));
    TEST_ASSERT_FALSE(bitmap.set(3));              // a repeated chunk (broadcast and repair) is not new
    TEST_ASSERT_FALSE(bitmap.set(5));              // out of range
    TEST_ASSERT_TRUE(bitmap.has(3));
    TEST_ASSERT_FALSE(bitmap.has(2));
    TEST_ASSERT_EQUAL(1, bitmap.count());
    TEST_ASSERT_EQUAL(20, bitmap.percent());
    TEST_ASSERT_EQUAL(200, bitmap.bytes());
}

void test_bitmap_bytes_follow_the_short_last_chunk() {
    OtaBitmap bitmap;
    bitmap.reset(450);                             // 200 + 200 + 50
    bitmap.set(2);
    TEST_ASSERT_EQUAL(50, bitmap.bytes());
    bitmap.set(0);
    bitmap.set(1);
    TEST_ASSERT_TRUE(bitmap.complete());
    TEST_ASSERT_EQUAL(450, bitmap.bytes());
    TEST_ASSERT_EQUAL(100, bitmap.percent());
}

void test_bitmap_finds_missing_chunks_in_any_order() {
    OtaBitmap bitmap;
    bitmap.reset(2000);                            // 10 chunks
    for(uint16_t i : {0, 1, 2, 4, 5, 9}) bitmap.set(i);
    TEST_ASSERT_EQUAL(3, bitmap.nextMissing(0));
    TEST_ASSERT_EQUAL(3, bitmap.nextMissing(3));
    TEST_ASSERT_EQUAL(6, bitmap.nextMissing(4));
    TEST_ASSERT_EQUAL(6, bitmap.nextMissing(6));
    TEST_ASSERT_EQUAL(3, bitmap.nextMissing(9));   // wraps around
    TEST_ASSERT_EQUAL(3, bitmap.nextMissing(50));  // a cursor past the end starts over
    for(uint16_t i : {3, 6, 7, 8}) bitmap.set(i);
    TEST_ASSERT_EQUAL(-1, bitmap.nextMissing(0));
    TEST_ASSERT_TRUE(bitmap.complete());
}

void test_bitmap_rejects_an_image_beyond_the_table_and_resets() {
    OtaBitmap bitmap;
    TEST_ASSERT_FALSE(bitmap.reset((uint32_t)(OtaBitmap::MAX_CHUNKS + 1) * OtaBitmap::CHUNK));
    TEST_ASSERT_FALSE(bitmap.complete());
    TEST_ASSERT_EQUAL(-1, bitmap.nextMissing(0));
    TEST_ASSERT_TRUE(bitmap.reset(400));
    bitmap.set(0);
    bitmap.reset(400);                             // a new update starts empty
    TEST_ASSERT_EQUAL(0, bitmap.count());
    TEST_ASSERT_FALSE(bitmap.has(0));
}

void test_hex_and_bytes() {
    const char* hex = "00ff10a5e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b";
    uint8_t bytes[32];
    TEST_ASSERT_TRUE(hexToBytes(hex, bytes));
    TEST_ASSERT_EQUAL_UINT8(0x00, bytes[0]);
    TEST_ASSERT_EQUAL_UINT8(0xff, bytes[1]);
    TEST_ASSERT_EQUAL_UINT8(0xa5, bytes[3]);
    char back[65];
    bytesToHex(bytes, back);
    TEST_ASSERT_EQUAL_STRING(hex, back);
    TEST_ASSERT_FALSE(hexToBytes("abc", bytes));
}

void test_pod_state_names_for_the_central() {
    using namespace Protocol;
    TEST_ASSERT_EQUAL_STRING("queued", podStateName(OTA_POD_NONE, true, false, true));
    TEST_ASSERT_EQUAL_STRING("transferring", podStateName(OTA_POD_PREPARING, true, false, true));
    TEST_ASSERT_EQUAL_STRING("transferring", podStateName(OTA_POD_RECEIVING, true, false, true));
    TEST_ASSERT_EQUAL_STRING("ready", podStateName(OTA_POD_READY, true, false, true));
    TEST_ASSERT_EQUAL_STRING("failed", podStateName(OTA_POD_FAILED, true, false, true));
    TEST_ASSERT_EQUAL_STRING("refused", podStateName(OTA_POD_LOW_BATTERY, true, false, true));
    TEST_ASSERT_EQUAL_STRING("offline", podStateName(OTA_POD_RECEIVING, false, false, true));     // a silent pod is lost whatever it said
    TEST_ASSERT_EQUAL_STRING("current", podStateName(OTA_POD_NONE, true, true, true));
    TEST_ASSERT_EQUAL_STRING("failed", podStateName(OTA_POD_NONE, true, false, false));
}

void test_force_needs_a_known_matching_link_protocol() {
    TEST_ASSERT_TRUE(forceAllowed(1, 1));
    TEST_ASSERT_FALSE(forceAllowed(2, 1));
    TEST_ASSERT_FALSE(forceAllowed(0, 1));         // otaBegin gave no linkProtocol
}

void test_overall_percent_is_the_mean() {
    TEST_ASSERT_EQUAL(100, overallPercent(0, 0));
    TEST_ASSERT_EQUAL(50, overallPercent(100, 2));
    TEST_ASSERT_EQUAL(66, overallPercent(200, 3));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_write_must_continue_at_received);
    RUN_TEST(test_write_cannot_pass_the_announced_size);
    RUN_TEST(test_write_needs_a_receiving_update_and_data);
    RUN_TEST(test_sha256_text);
    RUN_TEST(test_begin_resumes_only_the_same_open_image);
    RUN_TEST(test_battery_and_progress_and_timeout);
    RUN_TEST(test_state_names_and_progress);
    RUN_TEST(test_chunk_arithmetic);
    RUN_TEST(test_bitmap_counts_each_chunk_once);
    RUN_TEST(test_bitmap_bytes_follow_the_short_last_chunk);
    RUN_TEST(test_bitmap_finds_missing_chunks_in_any_order);
    RUN_TEST(test_bitmap_rejects_an_image_beyond_the_table_and_resets);
    RUN_TEST(test_hex_and_bytes);
    RUN_TEST(test_pod_state_names_for_the_central);
    RUN_TEST(test_force_needs_a_known_matching_link_protocol);
    RUN_TEST(test_overall_percent_is_the_mean);
    return UNITY_END();
}
