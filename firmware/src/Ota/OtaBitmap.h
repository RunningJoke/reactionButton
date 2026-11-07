#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

/**
 * Which chunks of an image a peripheral has (#130, link-protocol.md §5.3), free of ESP headers so that the
 * native tests run it (test/test_ota). Chunk i holds the bytes i * CHUNK ... of the image, the last one is
 * shorter. Chunks arrive in any order (broadcast, repair), so the image is written with offsets and checked
 * at the end.
 */
class OtaBitmap {
    public:
        static const uint16_t CHUNK = 200;          // Protocol::OTA_CHUNK_DATA
        static const uint16_t MAX_CHUNKS = 9216;    // 1792 KB slot / 200 B, rounded up: 1152 bytes of bits

        static uint32_t chunkCount(uint32_t size) { return (size + CHUNK - 1) / CHUNK; }
        static uint32_t chunkOffset(uint16_t index) { return (uint32_t)index * CHUNK; }
        // 0 past the end
        static uint16_t chunkLength(uint16_t index, uint32_t size) {
            uint32_t offset = chunkOffset(index);
            return offset >= size ? 0 : (uint16_t)(size - offset < CHUNK ? size - offset : CHUNK);
        }

        // Starts over for an image of `size` bytes; false if it needs more than MAX_CHUNKS
        bool reset(uint32_t size) {
            memset(this->bits, 0, sizeof(this->bits));
            this->size = size;
            this->total = chunkCount(size);
            this->have = 0;
            if(this->total > MAX_CHUNKS) {
                this->total = 0;
                return false;
            }
            return true;
        }

        bool has(uint16_t index) const { return index < this->total && (this->bits[index >> 3] & (1 << (index & 7))) != 0; }

        // true if the chunk was new
        bool set(uint16_t index) {
            if(index >= this->total || this->has(index)) {
                return false;
            }
            this->bits[index >> 3] |= (1 << (index & 7));
            this->have++;
            return true;
        }

        bool complete() const { return this->total > 0 && this->have == this->total; }
        uint32_t count() const { return this->have; }
        uint32_t chunks() const { return this->total; }
        uint32_t imageSize() const { return this->size; }

        // Bytes received so far (the short last chunk counts with its real length)
        uint32_t bytes() const {
            uint32_t bytes = this->have * CHUNK;
            if(this->total > 0 && this->has((uint16_t)(this->total - 1))) {
                bytes -= CHUNK - chunkLength((uint16_t)(this->total - 1), this->size);
            }
            return bytes;
        }

        uint8_t percent() const { return this->total == 0 ? 0 : (uint8_t)((uint64_t)this->have * 100 / this->total); }

        // The first chunk without data at or after `from`, wrapping around; -1 if all are there
        int32_t nextMissing(uint16_t from) const {
            for(uint32_t step = 0; step < this->total; step++) {
                uint32_t index = (from + step) % this->total;
                if(!this->has((uint16_t)index)) {
                    return (int32_t)index;
                }
            }
            return -1;
        }

    private:
        uint8_t bits[MAX_CHUNKS / 8] = {};
        uint32_t size = 0;
        uint32_t total = 0;
        uint32_t have = 0;
};
