#ifndef SUMMARYBLOCK_H
#define SUMMARYBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"
#include "Block/Value.h"

/**
 * Prints the statistics of a recorded metric and optionally copies them into variables,
 * so following blocks can react on them (e.g. colour by average time).
 *
 *   { "type": "summary", "metric": "reaction",
 *     "storeAverage": "AVG", "storeBest": "BEST", "storeWorst": "WORST", "storeCount": "HITS",
 *     "reset": true,                   clear the statistics afterwards (default true)
 *     "show": true, "targetMs": 450,   bar on the central's ring (programFormat 6, programs.md §7.7)
 *     "showMs": 3000,                  how long the bar stays (default 3000; 0 = until the next LED change)
 *     "next": "..." }
 *
 * Serial output:  SUMMARY,<metric>,<count>,<average>,<best>,<worst>
 *
 * With "show" the block waits: the bar (effect level) shows the average against targetMs for
 * showMs, then the block leaves through next. No values for the metric: no bar, no wait.
 */
class SummaryBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        void enter(BlockContext& ctx) override;
        void resume(BlockContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        // Reads the statistics once after entering, stores them, shows the bar when asked
        void collect(BlockContext& ctx);
        void showBar(BlockContext& ctx, int32_t average);

        std::string metric;
        VarId averageVar = -1;
        VarId bestVar = -1;
        VarId worstVar = -1;
        VarId countVar = -1;
        bool reset = true;
        bool show = false;
        Value targetMs;
        Value showMs;
        bool started = false;       // collect() ran for this entry
        bool showing = false;       // the bar is on the ring and the block waits for showMs
        uint32_t until = 0;         // end of the bar (millis)
};

#endif
