// Stub: FreeRTOS base types (ESP-IDF flavour).
#pragma once
#include <stdint.h>
#include <stddef.h>

typedef int BaseType_t;
typedef unsigned int UBaseType_t;
typedef uint32_t TickType_t;

#define pdFALSE ((BaseType_t)0)
#define pdTRUE ((BaseType_t)1)
#define pdPASS pdTRUE
#define pdFAIL pdFALSE
#define portMAX_DELAY ((TickType_t)0xffffffffUL)
#define portTICK_PERIOD_MS 10
#define configTICK_RATE_HZ 100
#define pdMS_TO_TICKS(ms) ((TickType_t)(((uint64_t)(ms) * configTICK_RATE_HZ) / 1000))
#define tskNO_AFFINITY 0x7FFFFFFF

typedef struct {
    int owner;
    int count;
} portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {0, 0}
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
#define portENTER_CRITICAL_ISR(mux) ((void)(mux))
#define portEXIT_CRITICAL_ISR(mux) ((void)(mux))
