#pragma once

#include <Arduino.h>
#include "HWCDC.h"

/**
 * The ESP32-C3's built-in USB serial port (USB-Serial-JTAG), used for all text output
 * of the firmware and for the serial configuration API.
 *
 * Why not `Serial`: in this "arduino, espidf" build the Arduino core is compiled without
 * ARDUINO_USB_CDC_ON_BOOT, so `Serial` is UART0 (GPIO 20/21), not the USB port.
 *
 * Writes never block when no USB host is connected (data is dropped).
 */
extern HWCDC Console;

// Starts the USB console and routes ESP-IDF log output (ESP_LOGx) to it as well
void consoleBegin();
