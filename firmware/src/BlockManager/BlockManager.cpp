#include "BlockManager.h"
#include <SPIFFS.h>
#include "Block/BlockFactory/BlockFactory.h"
#include "Link/IPodNetwork.h"

static const char* TAG = "BLOCKMANAGER";

BlockManager* BlockManager::manager = nullptr;

BlockManager* BlockManager::getManager() {

    if(BlockManager::manager == nullptr) {
        ESP_LOGI(TAG, "Initializing Block manager");
        BlockManager::manager = new BlockManager();
    }

    return BlockManager::manager;
};

BlockManager::BlockManager() {};

void BlockManager::clear() {
    for(Block* block : this->blocks) {
        delete block;
    }
    this->blocks.clear();
    this->pendingLinks.clear();
    this->startIndex = -1;
    this->currentIndex = -1;
    this->running = false;
    this->lastError = "";
}

bool BlockManager::fail(const String& message) {
    this->lastError = message;
    ESP_LOGE(TAG, "%s", message.c_str());
    return false;
}

bool BlockManager::loadProgram(const char* path, const char* text) {
    this->clear();

    VariableManager* vars = VariableManager::getManager();
    vars->clear();

    std::string startName;
    if(!this->loadFile(path, 0, startName, text) || !this->resolveLinks()) {
        this->clear();
        return false;
    }

    if(startName.empty()) {
        this->startIndex = this->blocks.empty() ? -1 : 0;
    } else {
        this->startIndex = this->findIndex(startName);
    }
    if(this->startIndex < 0) {
        this->fail(String(path) + ": start block '" + startName.c_str() + "' not found");
        this->clear();
        return false;
    }

    ESP_LOGI(TAG, "Loaded %s: %u blocks, start '%s'", path, (unsigned)this->blocks.size(),
             this->blocks[this->startIndex]->getName().c_str());
    return true;
}

bool BlockManager::loadFile(const char* path, uint8_t depth, std::string& startName, const char* text) {
    if(depth > MAX_INCLUDE_DEPTH) {
        return this->fail(String(path) + ": includes nested too deep");
    }

    JsonDocument doc;
    DeserializationError error;
    if(text != nullptr) {
        error = deserializeJson(doc, text);
    } else {
        File file = SPIFFS.open(path, "r");
        if(!file) {
            return this->fail(String("cannot open ") + path);
        }
        error = deserializeJson(doc, file);
        file.close();
    }
    if(error) {
        return this->fail(String(path) + ": " + error.c_str());
    }

    for(JsonVariantConst include : doc["include"].as<JsonArrayConst>()) {
        const char* includePath = include;
        std::string ignoredStart;
        if(includePath == nullptr || !this->loadFile(includePath, depth + 1, ignoredStart)) {
            return this->lastError.length() > 0 ? false : this->fail(String(path) + ": invalid include");
        }
    }

    VariableManager* vars = VariableManager::getManager();
    if(!doc["peripherals"].isNull()) {
        int64_t peripherals = doc["peripherals"];
        vars->setVariable("REQUIRED_PERIPHERALS", peripherals);
        vars->setVariable("NODE_COUNT", peripherals + 1);
    }
    for(JsonPairConst var : doc["variables"].as<JsonObjectConst>()) {
        if(!var.value().is<int64_t>()) {
            return this->fail(String(path) + ": variable '" + var.key().c_str() + "' must be a number");
        }
        vars->setVariable(var.key().c_str(), var.value().as<int64_t>());
    }

    const char* start = doc["start"];
    if(start != nullptr) {
        startName = start;
    }

    return this->loadBlocks(doc["blocks"].as<JsonArrayConst>(), path);
}

bool BlockManager::loadBlocks(JsonArrayConst blocks, const char* path) {
    BlockLoadContext loadContext{*VariableManager::getManager(), String()};

    for(JsonObjectConst json : blocks) {
        const char* name = json["name"];
        const char* type = json["type"];
        if(name == nullptr || type == nullptr) {
            return this->fail(String(path) + ": every block needs 'name' and 'type'");
        }
        if(this->findIndex(name) >= 0) {
            return this->fail(String(path) + ": duplicate block name '" + name + "'");
        }

        Block* block = BlockFactory::create(type);
        if(block == nullptr) {
            return this->fail(String(path) + ": block '" + name + "' has unknown type '" + type + "'");
        }
        block->name = name;
        this->blocks.push_back(block);   // owned from here on, freed by clear()

        if(!block->configure(json, loadContext)) {
            return this->fail(String(path) + ": block '" + name + "': " + loadContext.error);
        }

        PendingLinks links;
        for(uint8_t port = 0; port < block->portCount() && port < Block::MAX_PORTS; port++) {
            const char* target = json[block->portName(port)];
            if(target != nullptr) {
                links.targets[port] = target;
            }
        }
        this->pendingLinks.push_back(links);
    }
    return true;
}

bool BlockManager::resolveLinks() {
    for(size_t i = 0; i < this->blocks.size(); i++) {
        Block* block = this->blocks[i];
        bool anyPort = false;

        for(uint8_t port = 0; port < block->portCount() && port < Block::MAX_PORTS; port++) {
            const std::string& target = this->pendingLinks[i].targets[port];
            if(target.empty()) {
                continue;
            }
            int16_t index = this->findIndex(target);
            if(index < 0) {
                return this->fail(String("block '") + block->getName().c_str() + "' port '"
                                  + block->portName(port) + "': unknown block '" + target.c_str() + "'");
            }
            block->targets[port] = index;
            anyPort = true;
        }

        if(!anyPort) {
            ESP_LOGW(TAG, "block '%s' has no outgoing connection, the program ends there", block->getName().c_str());
        }
    }
    this->pendingLinks.clear();
    return true;
}

int16_t BlockManager::findIndex(const std::string& name) const {
    for(size_t i = 0; i < this->blocks.size(); i++) {
        if(this->blocks[i]->getName() == name) {
            return (int16_t)i;
        }
    }
    return -1;
}

bool BlockManager::start(IPodNetwork* network) {
    if(this->startIndex < 0) {
        return this->fail("no program loaded");
    }

    uint8_t peripheralCount = network != nullptr ? network->podCount() : 0;
    delete this->context;
    this->context = new BlockContext{
        *VariableManager::getManager(),
        *LEDManager::getManager(),
        Button::get(),
        Results::get(),
        network,
        peripheralCount
    };

    this->currentIndex = this->startIndex;
    this->running = true;
    this->enterCurrent();
    return true;
}

void BlockManager::run() {
    if(!this->running) {
        return;
    }
    BlockContext& ctx = *this->context;

    for(uint8_t step = 0; step < MAX_STEPS_PER_PASS; step++) {
        Block* block = this->blocks[this->currentIndex];
        BlockStatus status = block->execute(ctx);
        if(status.isRunning()) {
            return;
        }

        int16_t next = block->getTarget(status.port);
        // unconnected ports fall back to "next" if the block has one
        if(next < 0 && status.port != 0 && strcmp(block->portName(0), "next") == 0) {
            next = block->getTarget(0);
        }

        block->exit(ctx);

        if(next < 0) {
            ESP_LOGI(TAG, "program ended in block '%s'", block->getName().c_str());
            this->running = false;
            return;
        }

        this->currentIndex = next;
        this->enterCurrent();
    }
}

void BlockManager::restartCurrentBlock() {
    if(!this->running) {
        return;
    }
    this->blocks[this->currentIndex]->exit(*this->context);
    this->enterCurrent();
}

void BlockManager::enterCurrent() {
    Block* block = this->blocks[this->currentIndex];
    block->enter(*this->context);
    if(this->enterHook != nullptr) {
        this->enterHook(block->getName().c_str());
    }
}

const char* BlockManager::currentBlockName() const {
    if(!this->running || this->currentIndex < 0) {
        return "";
    }
    return this->blocks[this->currentIndex]->getName().c_str();
}
