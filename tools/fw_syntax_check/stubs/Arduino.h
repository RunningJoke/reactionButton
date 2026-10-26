// Host stub of the Arduino-ESP32 core (names and signatures only).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdarg.h>
#include <algorithm>
#include <string>
// the real core pulls these in through esp32-hal.h
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "WString.h"
#include "Print.h"
#include "HWCDC.h"

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x01
#define OUTPUT 0x03
#define INPUT_PULLUP 0x05
#define INPUT_PULLDOWN 0x09
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define PI 3.1415926535897932384626433832795
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

#ifndef constrain
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#endif
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define sq(x) ((x) * (x))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define PROGMEM
#define F(s) (reinterpret_cast<const __FlashStringHelper*>(PSTR(s)))
#define PSTR(s) (s)

typedef bool boolean;
typedef uint8_t byte;
typedef unsigned int word;

unsigned long millis();
unsigned long micros();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield();
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void analogWrite(uint8_t pin, int value);
void analogReadResolution(uint8_t bits);
void attachInterrupt(uint8_t pin, void (*fn)(void), int mode);
void detachInterrupt(uint8_t pin);
long random(long max);
long random(long min, long max);
void randomSeed(unsigned long seed);
long map(long x, long in_min, long in_max, long out_min, long out_max);
uint32_t getCpuFrequencyMhz();
bool setCpuFrequencyMhz(uint32_t mhz);

void initArduino();
void setup();
void loop();

class EspClass {
public:
    uint32_t getFreeHeap();
    uint32_t getMinFreeHeap();
    uint32_t getHeapSize();
    uint32_t getMaxAllocHeap();
    uint64_t getEfuseMac();
    void restart();
};
extern EspClass ESP;
