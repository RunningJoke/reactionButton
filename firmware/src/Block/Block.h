#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string>
#include "Block/BlockContext.h"

/**
 * Result of one execute() call.
 *   running()  - block keeps waiting, execute() is called again on the next pass
 *   done(p)    - block finished and leaves through output port p
 */
struct BlockStatus {
    int8_t port;

    static BlockStatus running() { return BlockStatus{-1}; }
    static BlockStatus done(uint8_t port = 0) { return BlockStatus{(int8_t)port}; }
    bool isRunning() const { return port < 0; }
};

/**
 * Collects errors while a program is loaded. Blocks call fail() from configure().
 */
struct BlockLoadContext {
    VariableManager& vars;
    String error;

    bool fail(const String& message) {
        if(this->error.length() == 0) {
            this->error = message;
        }
        return false;
    }
};

/**
 * Base class of all blocks.
 *
 * A block declares named output ports (portName / portCount). Port 0 is the default
 * port. If port 0 is called "next", every other port that is not connected in JSON falls
 * back to it. In JSON each port is a key with the target block name:
 *
 *   { "name": "Hit", "type": "button", "pressed": "ShowCyan", "timeout": "Miss" }
 *
 * Adding a new block type:
 *   1. derive from Block, implement configure() and execute()
 *   2. override portCount()/portName() if it has more than the "next" port
 *   3. add one line to the table in BlockFactory.cpp
 */
class Block {
    public:
        static const uint8_t MAX_PORTS = 6;

        virtual ~Block() {}

        // Reads the type-specific JSON fields. Return ctx.fail("...") on invalid input.
        virtual bool configure(JsonObjectConst json, BlockLoadContext& ctx) { return true; }

        // Called for every block when the program starts. Clears state that lives across
        // entries (e.g. the counter of a repeat block).
        virtual void onProgramStart() {}

        // Called every time the block becomes the current block (also when it re-enters itself).
        virtual void enter(BlockContext& ctx) {}

        // Called instead of enter() when a pause (restartCurrentBlock) enters the block again.
        // The block was not left, so blocks that must not repeat their entry work (e.g. building
        // a report) override this. The default is enter().
        virtual void resume(BlockContext& ctx) { this->enter(ctx); }

        // Called once per pass while the block is current.
        virtual BlockStatus execute(BlockContext& ctx) = 0;

        // Called when the block is left.
        virtual void exit(BlockContext& ctx) {}

        virtual uint8_t portCount() const { return 1; }
        virtual const char* portName(uint8_t port) const { return "next"; }

        const std::string& getName() const { return this->name; }

        int16_t getTarget(uint8_t port) const { return port < MAX_PORTS ? this->targets[port] : -1; }

    protected:
        // Lets a block check whether an optional port is wired, e.g. to decide whether to
        // react on press (port "pressed" connected) or on release.
        bool isConnected(uint8_t port) const { return this->getTarget(port) >= 0; }

    private:
        friend class BlockManager;

        std::string name;
        int16_t targets[MAX_PORTS] = {-1, -1, -1, -1, -1, -1};

        // "timerStart" / "timerStop" of any block: index into BlockManager's timers, -1 = none
        int8_t timerStart = -1;
        int8_t timerStop = -1;
};
