// Stub: mbedTLS base64 (only what Ota uses).
#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
int mbedtls_base64_decode(unsigned char* dst, size_t dlen, size_t* olen, const unsigned char* src, size_t slen);
#ifdef __cplusplus
}
#endif
