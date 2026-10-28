#include "CommunicateBlock.h"
#include "Block/JsonUtil.h"
#include "Config/SerialConsole.h"
#include "Results/Reports.h"

CommunicateBlock* CommunicateBlock::waitingBlock = nullptr;

namespace {
    bool validName(const std::string& name) {
        return !name.empty() && name.length() <= Reports::MAX_NAME;
    }
}

CommunicateBlock::~CommunicateBlock() {
    if(waitingBlock == this) {
        waitingBlock = nullptr;
    }
}

const char* CommunicateBlock::portName(uint8_t port) const {
    static const char* const NAMES[PORT_COUNT] = {"next", "pressed", "timeout", "repeat", "stop"};
    return port < PORT_COUNT ? NAMES[port] : nullptr;
}

bool CommunicateBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->timeoutMs.parse(json["timeoutMs"], ctx.vars)) {
        return ctx.fail("invalid 'timeoutMs'");
    }
    if(!json["color"].isNull() && !JsonUtil::parseColor(json["color"], this->color)) {
        return ctx.fail("invalid 'color'");
    }

    if(!json["metrics"].isNull()) {
        if(!json["metrics"].is<JsonArrayConst>()) {
            return ctx.fail("'metrics' must be a list");
        }
        for(JsonVariantConst item : json["metrics"].as<JsonArrayConst>()) {
            std::string name;
            if(this->metrics.size() >= MAX_LIST) {
                return ctx.fail("at most 8 'metrics'");
            }
            if(!JsonUtil::getString(item, name) || !validName(name)) {
                return ctx.fail("'metrics' needs names of 1 to 32 characters");
            }
            this->metrics.push_back(name);
        }
    }

    if(!json["vars"].isNull()) {
        if(!json["vars"].is<JsonArrayConst>()) {
            return ctx.fail("'vars' must be a list");
        }
        for(JsonVariantConst item : json["vars"].as<JsonArrayConst>()) {
            std::string name;
            if(this->varNames.size() >= MAX_LIST) {
                return ctx.fail("at most 8 'vars'");
            }
            if(!JsonUtil::getString(item, name) || !validName(name)) {
                return ctx.fail("'vars' needs variable names of 1 to 32 characters");
            }
            // resolve, not find: an include's blocks load before the including file's variables (validator checks the names)
            VarId var = ctx.vars.resolve(name.c_str());
            this->varNames.push_back(name);
            this->varIds.push_back(var);
        }
    }

    if(!json["editable"].isNull()) {
        if(!json["editable"].is<JsonObjectConst>()) {
            return ctx.fail("'editable' must be an object");
        }
        for(JsonPairConst pair : json["editable"].as<JsonObjectConst>()) {
            std::string name = pair.key().c_str();
            if(this->editables.size() >= MAX_LIST) {
                return ctx.fail("at most 8 'editable' variables");
            }
            if(!validName(name)) {
                return ctx.fail("'editable' needs variable names of 1 to 32 characters");
            }
            // resolve, not find: an include's blocks load before the including file's variables (validator checks the names)
            VarId var = ctx.vars.resolve(name.c_str());
            JsonVariantConst range = pair.value();
            if(!range["min"].is<int64_t>() || !range["max"].is<int64_t>()
                    || range["min"].as<int64_t>() > range["max"].as<int64_t>()) {
                return ctx.fail(String("'editable': '") + name.c_str() + "' needs integer 'min' and 'max', min <= max");
            }
            Editable editable;
            editable.name = name;
            editable.var = var;
            editable.min = range["min"].as<int64_t>();
            editable.max = range["max"].as<int64_t>();
            this->editables.push_back(editable);
        }
    }
    return true;
}

void CommunicateBlock::enter(BlockContext& ctx) {
    this->pendingCommand = Command::NONE;
    this->pressCountAtEnter = ctx.button.pressCount();
    this->timeoutAtEnter = this->timeoutMs.get(ctx.vars);
    this->sendReport(ctx);
    this->startWaiting(ctx);
}

// Pause: the report of this entry stays, the timeout starts again
void CommunicateBlock::resume(BlockContext& ctx) {
    this->startWaiting(ctx);
}

void CommunicateBlock::exit(BlockContext& ctx) {
    if(waitingBlock == this) {
        waitingBlock = nullptr;
    }
}

void CommunicateBlock::sendReport(BlockContext& ctx) {
    std::vector<Reports::Var> vars;
    for(size_t i = 0; i < this->varIds.size(); i++) {
        Reports::Var var;
        var.name = this->varNames[i];
        var.value = ctx.vars.get(this->varIds[i]);
        vars.push_back(var);
    }

    Reports& reports = Reports::get();
    const Reports::Report& report = reports.build(this->metrics, vars, millis());

    JsonDocument event;
    JsonObject out = event.to<JsonObject>();
    out["event"] = "report";
    Reports::write(report, out);
    SerialConsole::emit(event);
}

void CommunicateBlock::startWaiting(BlockContext& ctx) {
    this->waitStartMs = millis();
    ctx.leds.setLEDColors(&this->color);
    waitingBlock = this;
}

BlockStatus CommunicateBlock::execute(BlockContext& ctx) {
    // a client command, a press of the central's button, then the timeout
    switch(this->pendingCommand) {
        case Command::CONTINUE:
            this->pendingCommand = Command::NONE;
            return BlockStatus::done(NEXT);
        case Command::REPEAT:
            this->pendingCommand = Command::NONE;
            return BlockStatus::done(REPEAT);
        case Command::STOP:
            this->pendingCommand = Command::NONE;
            return BlockStatus::done(STOP);
        case Command::NONE:
            break;
    }

    if(ctx.button.pressCount() != this->pressCountAtEnter) {
        return BlockStatus::done(PRESSED);
    }
    if(this->timeoutAtEnter > 0 && (int64_t)(millis() - this->waitStartMs) >= this->timeoutAtEnter) {
        return BlockStatus::done(TIMEOUT);
    }
    return BlockStatus::running();
}
