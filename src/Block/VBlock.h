#ifndef VBLOCK_H
#define VBLOCK_H


#include <Arduino.h>
#include <string.h>
#include "Block/IBlockConfiguration.h"

typedef int8_t block_err_t;

class VBlock {
    protected:
        IBlockConfiguration* genericBlockConfiguration;
    public:
        virtual String getBlockName();
        virtual block_err_t executeBlock() = 0;
        virtual IBlockConfiguration* getBlockConfiguration();
};

#endif