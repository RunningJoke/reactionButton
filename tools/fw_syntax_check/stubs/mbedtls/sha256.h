// Stub: mbedTLS SHA-256 (only what Ota uses, mbedtls 2.28 API of ESP-IDF 4.4).
#pragma once
#include <stddef.h>
#include <stdint.h>
typedef struct { uint32_t state[8]; uint8_t buffer[64]; uint32_t total[2]; int is224; } mbedtls_sha256_context;
#ifdef __cplusplus
extern "C" {
#endif
void mbedtls_sha256_init(mbedtls_sha256_context* ctx);
void mbedtls_sha256_free(mbedtls_sha256_context* ctx);
int mbedtls_sha256_starts_ret(mbedtls_sha256_context* ctx, int is224);
int mbedtls_sha256_update_ret(mbedtls_sha256_context* ctx, const unsigned char* input, size_t ilen);
int mbedtls_sha256_finish_ret(mbedtls_sha256_context* ctx, unsigned char output[32]);
#ifdef __cplusplus
}
#endif
