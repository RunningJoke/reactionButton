// Pure parts of the block engine: parameter parsing (Value, JsonUtil). The block classes, BlockManager and
// BlockFactory need the whole runtime (LEDManager, buttons, timers, console), so they are not built on the host.
#include <unity.h>
#include <ArduinoJson.h>
#include "Block/Value.h"
#include "Block/JsonUtil.h"
#include "VariableManager/VariableManager.h"

void setUp() {
    VariableManager::getManager()->clear();
}

void tearDown() {}

static JsonDocument parse(const char* text) {
    JsonDocument doc;
    deserializeJson(doc, text);
    return doc;
}

void test_value_constant_and_variable_reference() {
    VariableManager* vars = VariableManager::getManager();
    vars->setVariable("MAX_LOOPS", 12);

    JsonDocument constant = parse("42");
    Value a;
    TEST_ASSERT_TRUE(a.parse(constant.as<JsonVariantConst>(), *vars));
    TEST_ASSERT_TRUE(a.isConstant());
    TEST_ASSERT_EQUAL_INT64(42, a.constantValue());
    TEST_ASSERT_EQUAL_INT64(42, a.get(*vars));

    JsonDocument reference = parse("\"MAX_LOOPS\"");
    Value b;
    TEST_ASSERT_TRUE(b.parse(reference.as<JsonVariantConst>(), *vars));
    TEST_ASSERT_FALSE(b.isConstant());
    TEST_ASSERT_EQUAL_INT64(12, b.get(*vars));
    vars->setVariable("MAX_LOOPS", 3);   // read at run time, not at load time
    TEST_ASSERT_EQUAL_INT64(3, b.get(*vars));
}

void test_value_missing_keeps_default_and_bad_type_fails() {
    VariableManager* vars = VariableManager::getManager();
    Value kept(7);
    JsonDocument none = parse("null");
    TEST_ASSERT_TRUE(kept.parse(none.as<JsonVariantConst>(), *vars));
    TEST_ASSERT_EQUAL_INT64(7, kept.get(*vars));
    TEST_ASSERT_TRUE(kept.isSet());

    JsonDocument flag = parse("true");
    Value bad;
    TEST_ASSERT_FALSE(bad.parse(flag.as<JsonVariantConst>(), *vars));
    TEST_ASSERT_FALSE(bad.isSet());
}

void test_color_names_hex_and_rgb_arrays() {
    ColorSet color;
    JsonDocument named = parse("\"Blue\"");
    TEST_ASSERT_TRUE(JsonUtil::parseColor(named.as<JsonVariantConst>(), color));
    TEST_ASSERT_EQUAL_UINT8(255, color.blue);
    TEST_ASSERT_EQUAL_UINT8(0, color.red);

    JsonDocument hex = parse("\"#10ff80\"");
    TEST_ASSERT_TRUE(JsonUtil::parseColor(hex.as<JsonVariantConst>(), color));
    TEST_ASSERT_EQUAL_UINT8(0x10, color.red);
    TEST_ASSERT_EQUAL_UINT8(0xff, color.green);
    TEST_ASSERT_EQUAL_UINT8(0x80, color.blue);

    JsonDocument rgb = parse("[1, 2, 3]");
    TEST_ASSERT_TRUE(JsonUtil::parseColor(rgb.as<JsonVariantConst>(), color));
    TEST_ASSERT_EQUAL_UINT8(3, color.blue);

    JsonDocument unknown = parse("\"teal\"");
    TEST_ASSERT_FALSE(JsonUtil::parseColor(unknown.as<JsonVariantConst>(), color));
    JsonDocument shortHex = parse("\"#12\"");
    TEST_ASSERT_FALSE(JsonUtil::parseColor(shortHex.as<JsonVariantConst>(), color));
    JsonDocument twoItems = parse("[1, 2]");
    TEST_ASSERT_FALSE(JsonUtil::parseColor(twoItems.as<JsonVariantConst>(), color));
}

// Peripherals only understand the named colours: arbitrary RGB is rejected for the link.
void test_remote_colour_ids_reject_rgb() {
    uint8_t id = 99;
    JsonDocument green = parse("\"green\"");
    TEST_ASSERT_TRUE(JsonUtil::parseRemoteColor(green.as<JsonVariantConst>(), id));
    TEST_ASSERT_EQUAL_UINT8(1, id);

    JsonDocument off = parse("\"off\"");
    TEST_ASSERT_TRUE(JsonUtil::parseRemoteColor(off.as<JsonVariantConst>(), id));
    TEST_ASSERT_EQUAL_UINT8(255, id);

    JsonDocument hex = parse("\"#ff0000\"");
    TEST_ASSERT_FALSE(JsonUtil::parseRemoteColor(hex.as<JsonVariantConst>(), id));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_value_constant_and_variable_reference);
    RUN_TEST(test_value_missing_keeps_default_and_bad_type_fails);
    RUN_TEST(test_color_names_hex_and_rgb_arrays);
    RUN_TEST(test_remote_colour_ids_reject_rgb);
    return UNITY_END();
}
