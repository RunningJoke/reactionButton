#ifndef COMMUNICATEBLOCK_H
#define COMMUNICATEBLOCK_H

#include <Arduino.h>
#include <string>
#include <vector>
#include "Block/Block.h"
#include "Block/Value.h"
#include "ColorSet/ColorSet.h"

/**
 * Sends a report of the measurements since the last one to the client, then waits for its
 * answer (programs.md §2, §7.16). Central only.
 *
 *   { "type": "communicate", "timeoutMs": 3000, "metrics": ["reaction"], "vars": ["RUNS"],
 *     "editable": { "MAX_LOOPS": { "min": 1, "max": 50 } }, "color": "cyan",
 *     "next": "StartCycle", "pressed": "Again", "timeout": "End", "repeat": "Reset", "stop": "End" }
 *
 * enter() builds the report and puts it into the report buffer (Results/Reports) and on the
 * serial console. The client answers with the config API "command" (continue / repeat / stop),
 * "setVariables" changes the editable variables while the block waits, and "ack" removes the
 * report. A pause (Block::resume) does not build a second report.
 */
class CommunicateBlock : public Block {
    public:
        enum Port : uint8_t { NEXT = 0, PRESSED, TIMEOUT, REPEAT, STOP, PORT_COUNT };
        enum class Command : uint8_t { NONE, CONTINUE, REPEAT, STOP };

        static const uint8_t MAX_LIST = 8;      // metrics, vars and editable variables

        struct Editable {
            std::string name;
            VarId var;
            int64_t min;
            int64_t max;
        };

        ~CommunicateBlock() override;

        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        void resume(BlockContext& ctx) override;
        void exit(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

        uint8_t portCount() const override { return PORT_COUNT; }
        const char* portName(uint8_t port) const override;

        // The communicate block that waits right now (nullptr if none)
        static CommunicateBlock* waiting() { return waitingBlock; }

        // A client command for the waiting block; it is taken on the next pass
        void command(Command next) { this->pendingCommand = next; }

        const std::vector<Editable>& editable() const { return this->editables; }

    private:
        static CommunicateBlock* waitingBlock;

        void sendReport(BlockContext& ctx);
        void startWaiting(BlockContext& ctx);

        std::vector<std::string> metrics;
        std::vector<std::string> varNames;      // "vars": reported, read at the report
        std::vector<VarId> varIds;
        std::vector<Editable> editables;
        Value timeoutMs;
        ColorSet color = *CYAN;

        // per entry
        int64_t timeoutAtEnter = 0;             // read once on enter, 0 = no timeout
        uint32_t waitStartMs = 0;               // entry or last pause
        uint32_t pressCountAtEnter = 0;
        Command pendingCommand = Command::NONE;
};

#endif
