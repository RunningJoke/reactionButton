#pragma once

#define CHECK_BIT(var,pos) ((var) & (1<<(pos)))

/**
 * FIRMWARE VERSION (reported in HELLO frames)
*/
#define FW_VERSION_MAJOR 2
#define FW_VERSION_MINOR 0

/**
 * PIN DEFINITIONS
*/

#define PIN_BUTTON_PRESS 3
#define PIN_BATTERY_LEVEL 5

/**
 * POD LINK (ESP-NOW)
 * All pods of a set must use the same channel.
*/
#define ESPNOW_CHANNEL 1

/**
 * PHONE CONFIGURATION (BLE, central only, during the program menu)
*/
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHAR_MAX_LOOP_UUID     "12345678-1234-1234-1234-1234567890a7"
