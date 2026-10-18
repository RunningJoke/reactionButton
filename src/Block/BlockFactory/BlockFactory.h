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
};


#endif
