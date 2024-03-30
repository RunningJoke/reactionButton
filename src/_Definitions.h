#pragma once

#define CHECK_BIT(var,pos) ((var) & (1<<(pos)))

/**
 * PIN DEFINITIONS
*/

#define PIN_LED_INTERNAL 22
#define PIN_LED_RED 25
#define PIN_LED_GREEN 33
#define PIN_LED_BLUE 32

#define PIN_BUTTON_PRESS 18

/**
 * BLE DEFINITIONS
*/

#define BLE_NAME_STOPWATCH_ID 0
#define BLE_NAME_MODE_ID 1


/**
 * MODE DEFINITIONS
*/

#define MODE_REACTION 0
#define MODE_BUTTON 1


// UUIDS
#define BLE_REACTION_POD_ID "7a675ad4-770c-46ed-9cd1-813ee38f3503"
#define BLE_MODE_UID "31f89785-3d4e-4bf8-a6c1-d465a218bb3f"
#define BLE_REACTION_TIME_UID "5c93c690-eb0f-4350-a03f-3bd52587d5f5"