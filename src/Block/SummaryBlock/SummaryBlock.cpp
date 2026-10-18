#include "SummaryBlock.h"
#include "Block/JsonUtil.h"

static VarId optionalVar(JsonVariantConst json, VariableManager& vars) {
    const char* name = json;
    return name != nullptr ? vars.resolve(name) : -1;
}

bool SummaryBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!JsonUtil::getString(json["metric"], this->metric)) {
        return ctx.fail("missing 'metric'");
    }
    this->averageVar = optionalVar(json["storeAverage"], ctx.vars);
    this->bestVar = optionalVar(json["storeBest"], ctx.vars);
    this->worstVar = optionalVar(json["storeWorst"], ctx.vars);
    this->countVar = optionalVar(json["storeCount"], ctx.vars);
    this->reset = json["reset"] | true;
    return true;
}

BlockStatus SummaryBlock::execute(BlockContext& ctx) {
    Results::Stats s = ctx.results.stats(this->metric.c_str());
    int32_t best = s.count > 0 ? s.min : 0;
    int32_t worst = s.count > 0 ? s.max : 0;

    Serial.printf("SUMMARY,%s,%lu,%ld,%ld,%ld\n", this->metric.c_str(),
                  (unsigned long)s.count, (long)s.average(), (long)best, (long)worst);

    if(this->averageVar >= 0) ctx.vars.set(this->averageVar, s.average());
    if(this->bestVar >= 0) ctx.vars.set(this->bestVar, best);
    if(this->worstVar >= 0) ctx.vars.set(this->worstVar, worst);
    if(this->countVar >= 0) ctx.vars.set(this->countVar, s.count);

    if(this->reset) {
        ctx.results.reset(this->metric.c_str());
    }
    return BlockStatus::done();
}
