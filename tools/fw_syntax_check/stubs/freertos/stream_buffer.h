// Stub: FreeRTOS stream buffers.
#pragma once
#include "FreeRTOS.h"

typedef void* StreamBufferHandle_t;

StreamBufferHandle_t xStreamBufferCreate(size_t bufferSizeBytes, size_t triggerLevelBytes);
void vStreamBufferDelete(StreamBufferHandle_t buffer);
size_t xStreamBufferSend(StreamBufferHandle_t buffer, const void* data, size_t bytes, TickType_t wait);
size_t xStreamBufferReceive(StreamBufferHandle_t buffer, void* data, size_t bufferLength, TickType_t wait);
BaseType_t xStreamBufferReset(StreamBufferHandle_t buffer);
size_t xStreamBufferBytesAvailable(StreamBufferHandle_t buffer);
