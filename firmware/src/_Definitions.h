#pragma once

#define CHECK_BIT(var,pos) ((var) & (1<<(pos)))

/**
 * FIRMWARE VERSION (reported in HELLO frames)
*/
#define FW_VERSION_MAJOR 2
#define FW_VERSION_MINOR 15

/**
 * LED BRIGHTNESS CAP (0..255, #21)
 * Applied to all LED output in LEDManager::scaled(): static colours, effects, the boot gauge and
 * the identity. 255 = full brightness. Lower values reduce the current of the ring (battery).
*/
#define LED_BRIGHTNESS_CAP 255

/**
 * AUTO POWER-OFF (#21)
 * A pod that is idle this long goes to deep sleep after a short goodbye animation and wakes on the
 * button (Power/AutoPowerOff.h). Idle = an unclaimed peripheral, or a central in the menu without a
 * phone connected; a button press restarts the time.
*/
#define AUTO_POWER_OFF_MINUTES 10

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
#define CHAR_COMMAND_UUID      "12345678-1234-1234-1234-1234567890b1"   // phone -> pod, JSON lines
#define CHAR_RESPONSE_UUID     "12345678-1234-1234-1234-1234567890b2"   // pod -> phone, JSON lines (indicate)
