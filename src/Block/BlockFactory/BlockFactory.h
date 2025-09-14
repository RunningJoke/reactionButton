#ifndef BLOCKFACTORY_H
#define BLOCKFACTORY_H  

#include <Arduino.h>
#include "Block/VBlock.h"
#include "Block/IBlockConfiguration.h"

#include "Block/LEDBlock/LEDBlock.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/ButtonBlock/ButtonBlock.h"
#include "Block/RemotePressBlock/RemotePressBlock.h"
#include "Block/IfBlock/IfBlock.h"
#include "Block/SetVariableBlock/SetVariableBlock.h"



class BlockFactory
{   
    private:
    /* data */    
    static BlockFactory* factory;
    BlockFactory();
    public:
        static BlockFactory* getFactory();
        VBlock* createBlock(IBlockConfiguration* blockConfiguration);

};


#endif