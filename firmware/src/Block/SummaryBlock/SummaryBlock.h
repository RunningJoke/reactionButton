#ifndef SUMMARYBLOCK_H
#define SUMMARYBLOCK_H

#include <Arduino.h>
#include <string>
#include "Block/Block.h"

/**
 * Prints the statistics of a recorded metric and optionally copies them into variables,
 * so following blocks can react on them (e.g. colour by average time).
 *
 *   { "type": "summary", "metric": "reaction",
 *     "storeAverage": "AVG", "storeBest": "BEST", "storeWorst": "WORST", "storeCount": "HITS",
 *     "reset": true,                   clear the statistics afterwards (default true)
 *     "next": "..." }
 *
 * Serial output:  SUMMARY,<metric>,<count>,<average>,<best>,<worst>
 */
class SummaryBlock : public Block {
    public:
        bool configure(JsonObjectConst json, BlockLoadContext& ctx) override;
        BlockStatus execute(BlockContext& ctx) override;

    protected:
        std::string metric;
        VarId averageVar = -1;
        VarId bestVar = -1;
        VarId worstVar = -1;
        VarId countVar = -1;
        bool reset = true;
};

#endif
