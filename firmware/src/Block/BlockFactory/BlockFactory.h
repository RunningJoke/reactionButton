#ifndef BLOCKFACTORY_H
#define BLOCKFACTORY_H

#include <Arduino.h>
#include "Block/Block.h"

/**
 * Creates blocks by their JSON "type" name. The list of known types lives in
 * BlockFactory.cpp; adding a block type means adding one line there.
 */
class BlockFactory
{
    public:
        // Returns nullptr for unknown types
        static Block* create(const char* type);

        // Name of the i-th known type, nullptr past the end (reported to the phone API)
        static const char* typeName(size_t index);

        // Revision of the program format this firmware understands, reported as
        // "programFormat" in the config API info. Increase it whenever a block type gets
        // new fields, ports or semantics, and add a line to the changelog in docs/firmware/programs.md.
        static const uint32_t PROGRAM_FORMAT = 2;
};


#endif
