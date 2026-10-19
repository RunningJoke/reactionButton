#include "IfBlock.h"

bool IfBlock::configure(JsonObjectConst json, BlockLoadContext& ctx) {
    if(!this->left.parse(json["left"], ctx.vars) || !this->left.isSet()) {
        return ctx.fail("missing 'left'");
    }
    if(!this->right.parse(json["right"], ctx.vars) || !this->right.isSet()) {
        return ctx.fail("missing 'right'");
    }

    const char* op = json["op"] | "==";
    if(strcmp(op, "==") == 0 || strcmp(op, "=") == 0) this->op = Op::EQ;
    else if(strcmp(op, "!=") == 0 || strcmp(op, "!") == 0) this->op = Op::NE;
    else if(strcmp(op, ">") == 0) this->op = Op::GT;
    else if(strcmp(op, "<") == 0) this->op = Op::LT;
    else if(strcmp(op, ">=") == 0) this->op = Op::GE;
    else if(strcmp(op, "<=") == 0) this->op = Op::LE;
    else return ctx.fail("unknown 'op'");

    return true;
}

BlockStatus IfBlock::execute(BlockContext& ctx) {
    int64_t l = this->left.get(ctx.vars);
    int64_t r = this->right.get(ctx.vars);

    bool result = false;
    switch(this->op) {
        case Op::EQ: result = l == r; break;
        case Op::NE: result = l != r; break;
        case Op::GT: result = l > r; break;
        case Op::LT: result = l < r; break;
        case Op::GE: result = l >= r; break;
        case Op::LE: result = l <= r; break;
    }
    return BlockStatus::done(result ? 0 : 1);
}
