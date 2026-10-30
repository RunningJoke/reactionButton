// Stub: ESP-IDF USB serial / JTAG low-level HAL.
#pragma once
#include <stdint.h>

#define USB_SERIAL_JTAG_INTR_SERIAL_IN_EMPTY (1u << 3)
static inline void usb_serial_jtag_ll_txfifo_flush(void) {}
static inline void usb_serial_jtag_ll_ena_intr_mask(uint32_t mask) { (void)mask; }
