#ifndef BLOCKMANAGER_H
#define BLOCKMANAGER_H

#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"
#include "Block/BlockFactory/BlockFactory.h"

#define MAX_BLOCK_NUMBER 256



class BlockManager {
    private:
        BlockManager();
        static BlockManager* manager;
        uint32_t blockCount = 0;
        VBlock* blockList[MAX_BLOCK_NUMBER];

        uint32_t currentBlockIndex = 0;

        int32_t findNextBlockIndex();

    public:
        static BlockManager* getManager();
        block_err_t assignBlock(IBlockConfiguration* blockConfiguration);

        void defineStartBlock(String blockName);
        uint32_t findIndex(String blockName) ;


        void runBlocks();

};


#endif