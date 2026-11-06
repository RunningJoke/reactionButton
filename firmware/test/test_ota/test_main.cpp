#include <unity.h>
#include <stdlib.h>
#include <strings.h>
#include "Ota/OtaRules.h"

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

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_write_must_continue_at_received);
    RUN_TEST(test_write_cannot_pass_the_announced_size);
    RUN_TEST(test_write_needs_a_receiving_update_and_data);
    RUN_TEST(test_sha256_text);
    RUN_TEST(test_begin_resumes_only_the_same_open_image);
    RUN_TEST(test_battery_and_progress_and_timeout);
    RUN_TEST(test_state_names_and_progress);
    return UNITY_END();
}
