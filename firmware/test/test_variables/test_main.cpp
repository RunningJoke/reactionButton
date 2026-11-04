#include <unity.h>
#include "VariableManager/VariableManager.h"

void setUp() {
    VariableManager::getManager()->clear();
}

void tearDown() {}

void test_resolve_creates_variable_with_zero() {
    VariableManager* vars = VariableManager::getManager();
    VarId id = vars->resolve("MAX_LOOPS");
    TEST_ASSERT_EQUAL(id, vars->find("MAX_LOOPS"));
    TEST_ASSERT_EQUAL(0, vars->get(id));
    TEST_ASSERT_EQUAL(id, vars->resolve("MAX_LOOPS"));
    TEST_ASSERT_EQUAL(1, vars->count());
    TEST_ASSERT_EQUAL(-1, vars->find("UNKNOWN"));
}

void test_set_get_round_trip_keeps_64_bit_values() {
    VariableManager* vars = VariableManager::getManager();
    VarId a = vars->resolve("a");
    VarId b = vars->resolve("b");
    vars->set(a, 1LL << 40);
    vars->set(b, -42);
    TEST_ASSERT_EQUAL_INT64(1LL << 40, vars->get(a));
    TEST_ASSERT_EQUAL_INT64(-42, vars->get(b));
    TEST_ASSERT_EQUAL_STRING("a", vars->name(a));
}

void test_invalid_ids_read_zero_and_ignore_writes() {
    VariableManager* vars = VariableManager::getManager();
    vars->resolve("x");
    TEST_ASSERT_EQUAL_INT64(0, vars->get(-1));
    TEST_ASSERT_EQUAL_INT64(0, vars->get(5));
    vars->set(5, 99);
    vars->set(-1, 99);
    TEST_ASSERT_EQUAL_INT64(0, vars->get(0));
    TEST_ASSERT_EQUAL_STRING("?", vars->name(5));
}

void test_access_by_name_and_clear() {
    VariableManager* vars = VariableManager::getManager();
    TEST_ASSERT_EQUAL_INT64(0, vars->getVariable("missing"));
    TEST_ASSERT_EQUAL(-1, vars->find("missing"));   // reading does not create it
    vars->setVariable("score", 7);
    TEST_ASSERT_EQUAL_INT64(7, vars->getVariable("score"));
    vars->clear();
    TEST_ASSERT_EQUAL(0, vars->count());
    TEST_ASSERT_EQUAL(-1, vars->find("score"));
    TEST_ASSERT_EQUAL_INT64(0, vars->getVariable("score"));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_resolve_creates_variable_with_zero);
    RUN_TEST(test_set_get_round_trip_keeps_64_bit_values);
    RUN_TEST(test_invalid_ids_read_zero_and_ignore_writes);
    RUN_TEST(test_access_by_name_and_clear);
    return UNITY_END();
}
