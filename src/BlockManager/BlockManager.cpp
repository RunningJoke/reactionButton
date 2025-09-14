#include "BlockManager.h"

BlockManager* BlockManager::manager = nullptr;

BlockManager* BlockManager::getManager() {

    if(BlockManager::manager == nullptr) {        
        ESP_LOGI("BLOCKMANAGER", "Initializing Block manager");
        BlockManager::manager = new BlockManager();
    }

    return BlockManager::manager;
};

block_err_t BlockManager::assignBlock(IBlockConfiguration* blockConfiguration) {
    if(blockCount >= MAX_BLOCK_NUMBER) {
        return -1; // No more blocks available
    }

    blockList[blockCount] = BlockFactory::getFactory()->createBlock(blockConfiguration);
    blockCount++;

    Serial.print("Assigned block ");
    Serial.print(blockCount - 1);
    Serial.print(": ");
    Serial.println(blockConfiguration->blockName);

    return 0;
}

int32_t BlockManager::findNextBlockIndex() {
    for (uint32_t i = 0; i < blockCount; i++) {
        if (blockList[i]->getBlockName() == blockList[currentBlockIndex]->getBlockConfiguration()->getNextBlockName()) {
            Serial.print("Next block index: ");
            Serial.println(i);
            return i;
        }
    }
    return -1; // Not found
}

BlockManager::BlockManager() {}; 

void BlockManager::defineStartBlock(String blockName) {
    this->currentBlockIndex = this->findIndex(blockName);
};

uint32_t BlockManager::findIndex(String blockName) {
    for (uint32_t i = 0; i < this->blockCount; i++) {
        if (this->blockList[i]->getBlockName() == blockName) {
            return i;
        }
    }
    return 0xFF;
}

void BlockManager::runBlocks() {
    this->blockList[this->currentBlockIndex]->executeBlock();
    const char* nextBlockName = this->blockList[this->currentBlockIndex]->getBlockConfiguration()->getNextBlockName();
    
    uint32_t nextBlockIndex = this->findIndex(nextBlockName);

    if(this->currentBlockIndex != nextBlockIndex) {
        //handle beforeExit and beforeEnter if block changed
        this->blockList[this->currentBlockIndex]->exitBlock();
        this->blockList[nextBlockIndex]->enterBlock();

        this->currentBlockIndex = nextBlockIndex;
    }
    return;
}


bool BlockManager::loadBlockConfigurationsFromJson(const String& filePath) {
    File file = SPIFFS.open(filePath, "r");
    if (!file) {
        ESP_LOGE("BLOCKMANAGER", "Failed to open config file");
        return false;
    }

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, file);
    file.close();

    if (error) {
        ESP_LOGE("BLOCKMANAGER", "JSON parse error");
        return false;
    }

    JsonArray blocks = doc["blocks"].as<JsonArray>();
    for (JsonObject block : blocks) {
        String type = block["type"];
        String name = block["name"];
        String next = block["next"];
        // Add more fields as needed

        IBlockConfiguration* config = nullptr;
        if (type == "fixedDelay") {
            uint32_t delayMs = block["delayMs"];
            config = new DelayBlockConfiguration(name.c_str(), next.c_str(), delayMs, delayMs);
        } else if (type == "randomDelay") {
            uint32_t minDelayMs = block["minDelayMs"];
            uint32_t maxDelayMs = block["maxDelayMs"];
            config = new DelayBlockConfiguration(name.c_str(), next.c_str(), minDelayMs, maxDelayMs);
            config = new ButtonBlockConfiguration(name.c_str(), next.c_str());
        } else if (type == "button") {

            String nextShortPress = block["nextShortPress"];
            String nextLongPress = block["nextLongPress"];
            String nextPressed = block["nextPressed"];
            String nextTimeout = block["nextTimeout"];

            config = new ButtonBlockConfiguration(name.c_str(), next.c_str());
        } else if(type == "remotePress") {
            String peripheralId = block["peripheralId"];
            config = new RemotePressBlockConfiguration(name.c_str(), next.c_str(), peripheralId.c_str());
        }
        // Add more types as needed

        if (config) {
            assignBlock(config);
        }
    }
    return true;
}