#include "BlockFactory.h"

#include "Block/LEDBlock/LEDBlock.h"
#include "Block/DelayBlock/DelayBlock.h"
#include "Block/ButtonBlock/ButtonBlock.h"
#include "Block/IfBlock/IfBlock.h"
#include "Block/SetVariableBlock/SetVariableBlock.h"
#include "Block/RemotePressBlock/RemotePressBlock.h"
#include "Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.h"
#include "Block/RemoteResetAllBlock/RemoteResetAllBlock.h"
#include "Block/SummaryBlock/SummaryBlock.h"
#include "Block/RepeatBlock/RepeatBlock.h"
#include "Block/EffectBlock/EffectBlock.h"

namespace {
    template<typename T>
    Block* createBlock() {
        return new T();
    }

    struct BlockType {
        const char* name;
        Block* (*create)();
    };

    // JSON "type" -> block class. Register new block types here.
    const BlockType BLOCK_TYPES[] = {
        {"led",              &createBlock<LEDBlock>},
        {"delay",            &createBlock<DelayBlock>},
        {"button",           &createBlock<ButtonBlock>},
        {"if",               &createBlock<IfBlock>},
        {"setVariable",      &createBlock<SetVariableBlock>},
        {"remotePress",      &createBlock<RemotePressBlock>},
        {"remoteMultiPress", &createBlock<RemoteMultiplePressBlock>},
        {"remoteResetAll",   &createBlock<RemoteResetAllBlock>},
        {"summary",          &createBlock<SummaryBlock>},
        {"repeat",           &createBlock<RepeatBlock>},
        {"effect",           &createBlock<EffectBlock>},
    };
}

Block* BlockFactory::create(const char* type) {
    if(type == nullptr) {
        return nullptr;
    }
    for(const BlockType& entry : BLOCK_TYPES) {
        if(strcmp(entry.name, type) == 0) {
            return entry.create();
        }
    }
    return nullptr;
}


const char* BlockFactory::typeName(size_t index) {
    return index < sizeof(BLOCK_TYPES) / sizeof(BLOCK_TYPES[0]) ? BLOCK_TYPES[index].name : nullptr;
}
