#ifndef BLOCKMANAGER_H
#define BLOCKMANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include <vector>
#include "Block/Block.h"
#include "Block/BlockContext.h"

class IPodNetwork;

/**
 * Loads a program (JSON) into blocks and runs it.
 *
 * Program file:
 *   {
 *     "version": 1,
 *     "name": "Dreieck",
 *     "peripherals": 2,                    -> REQUIRED_PERIPHERALS, NODE_COUNT = peripherals + 1
 *     "menu": [ { "leds": [7, 9, 11], "color": "blue" } ],
 *     "variables": { "MAX_LOOPS": 12 },    initial variable values
 *     "include": [ "/prog/lib/loop.json" ],  fragments with more "variables" / "blocks"
 *     "start": "StartLoop",                default: first block
 *     "blocks": [ { "name": "...", "type": "...", ...ports and parameters... } ]
 *   }
 *
 * Load order: includes (in order), then the program's own variables and blocks, so the
 * program can override defaults from a fragment. Block names must be unique.
 *
 * Runtime: run() is called once per loop pass. Blocks that finish immediately are
 * chained within the same pass (up to MAX_STEPS_PER_PASS), so a sequence like
 * LED -> setVariable -> if costs no extra loop passes.
 */
class BlockManager {
    public:
        static BlockManager* getManager();

        // Replaces the current program. On failure the old program is gone and
        // getLastError() describes the problem.
        // text: content of the program file instead of the stored file at path (dry run of
        // the config API "validate"); includes are still read from the store.
        bool loadProgram(const char* path, const char* text = nullptr);

        // Starts the loaded program from its start block
        bool start(IPodNetwork* network);

        void run();

        // Leaves and re-enters the current block, e.g. to re-arm pods after a pause
        void restartCurrentBlock();

        bool isRunning() const { return this->running; }

        // Name of the current block ("" if not running)
        const char* currentBlockName() const;

        // Test support: called with the block name whenever a block is entered (nullptr = off)
        void setEnterHook(void (*hook)(const char* blockName)) { this->enterHook = hook; }
        size_t blockCount() const { return this->blocks.size(); }
        const String& getLastError() const { return this->lastError; }

    private:
        static const uint8_t MAX_STEPS_PER_PASS = 32;
        static const uint8_t MAX_INCLUDE_DEPTH = 3;

        // Port targets by name, resolved to indices after all blocks are loaded
        struct PendingLinks {
            std::string targets[Block::MAX_PORTS];
        };

        BlockManager();
        static BlockManager* manager;

        bool loadFile(const char* path, uint8_t depth, std::string& startName, const char* text = nullptr);
        bool loadBlocks(JsonArrayConst blocks, const char* path);
        bool resolveLinks();
        int16_t findIndex(const std::string& name) const;
        void clear();
        bool fail(const String& message);

        std::vector<Block*> blocks;
        std::vector<PendingLinks> pendingLinks;
        int16_t startIndex = -1;
        int16_t currentIndex = -1;
        bool running = false;
        String lastError;

        BlockContext* context = nullptr;
        void (*enterHook)(const char* blockName) = nullptr;

        void enterCurrent();
};


#endif
