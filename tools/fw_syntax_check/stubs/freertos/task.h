// Stub: FreeRTOS tasks.
#pragma once
#include "FreeRTOS.h"

typedef void* TaskHandle_t;
typedef void (*TaskFunction_t)(void*);

BaseType_t xTaskCreate(TaskFunction_t fn, const char* name, uint32_t stackDepth, void* arg,
                       UBaseType_t priority, TaskHandle_t* handle);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char* name, uint32_t stackDepth, void* arg,
                                   UBaseType_t priority, TaskHandle_t* handle, BaseType_t core);
void vTaskDelete(TaskHandle_t task);
void vTaskDelay(TickType_t ticks);
TickType_t xTaskGetTickCount(void);
