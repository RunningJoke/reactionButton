// Stub: FreeRTOS semaphores and mutexes.
#pragma once
#include "FreeRTOS.h"

typedef void* SemaphoreHandle_t;

SemaphoreHandle_t xSemaphoreCreateMutex();
SemaphoreHandle_t xSemaphoreCreateRecursiveMutex();
SemaphoreHandle_t xSemaphoreCreateBinary();
void vSemaphoreDelete(SemaphoreHandle_t semaphore);
BaseType_t xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t wait);
BaseType_t xSemaphoreGive(SemaphoreHandle_t semaphore);
BaseType_t xSemaphoreTakeRecursive(SemaphoreHandle_t semaphore, TickType_t wait);
BaseType_t xSemaphoreGiveRecursive(SemaphoreHandle_t semaphore);
