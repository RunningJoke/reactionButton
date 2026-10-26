// Stub of the Arduino String (backed by std::string). Enough for ArduinoJson and the firmware.
#pragma once
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

class __FlashStringHelper;
#define FPSTR(p) (reinterpret_cast<const __FlashStringHelper*>(p))
#define pgm_read_byte(addr) (*(const unsigned char*)(addr))
#define pgm_read_word(addr) (*(const unsigned short*)(addr))
#define pgm_read_dword(addr) (*(const unsigned long*)(addr))
#define pgm_read_ptr(addr) (*(void* const*)(addr))
#define strlen_P(a) strlen(a)
#define strncmp_P(a, b, n) strncmp(a, b, n)
#define strcmp_P(a, b) strcmp(a, b)
#define memcpy_P(d, s, n) memcpy(d, s, n)

class Print;

class Printable {
public:
    virtual ~Printable() {}
    virtual size_t printTo(Print& p) const = 0;
};

class String {
public:
    String() {}
    String(const char* s) : s_(s ? s : "") {}
    String(const __FlashStringHelper* s) : s_(s ? (const char*)s : "") {}
    String(const std::string& s) : s_(s) {}
    String(const String&) = default;
    String(String&&) = default;
    String(char c) : s_(1, c) {}
    String(int v, unsigned char base = 10) : s_(num((long long)v, base)) {}
    String(unsigned int v, unsigned char base = 10) : s_(num((long long)v, base)) {}
    String(long v, unsigned char base = 10) : s_(num(v, base)) {}
    String(unsigned long v, unsigned char base = 10) : s_(num((long long)v, base)) {}
    String(long long v, unsigned char base = 10) : s_(num(v, base)) {}
    String(unsigned long long v, unsigned char base = 10) : s_(num((long long)v, base)) {}
    String(float v, unsigned char decimals = 2) : s_(flt(v, decimals)) {}
    String(double v, unsigned char decimals = 2) : s_(flt(v, decimals)) {}
    String& operator=(const String&) = default;
    String& operator=(String&&) = default;
    String& operator=(const char* s) { s_ = s ? s : ""; return *this; }

    const char* c_str() const { return s_.c_str(); }
    unsigned int length() const { return (unsigned int)s_.size(); }
    bool isEmpty() const { return s_.empty(); }
    bool reserve(unsigned int n) { s_.reserve(n); return true; }
    void clear() { s_.clear(); }
    char charAt(unsigned int i) const { return i < s_.size() ? s_[i] : 0; }
    char operator[](unsigned int i) const { return charAt(i); }
    char& operator[](unsigned int i) { return s_[i]; }
    explicit operator bool() const { return !s_.empty(); }

    String& concat(const String& o) { s_ += o.s_; return *this; }
    bool concat(const char* s) { if (s) s_ += s; return true; }
    bool concat(char c) { s_ += c; return true; }
    bool concat(const char* s, unsigned int n) { if (s) s_.append(s, n); return true; }
    String& operator+=(const String& o) { s_ += o.s_; return *this; }
    String& operator+=(const char* s) { if (s) s_ += s; return *this; }
    String& operator+=(char c) { s_ += c; return *this; }
    String& operator+=(int v) { s_ += num(v, 10); return *this; }
    String& operator+=(unsigned int v) { s_ += num(v, 10); return *this; }
    String& operator+=(long v) { s_ += num(v, 10); return *this; }
    String& operator+=(unsigned long v) { s_ += num((long long)v, 10); return *this; }

    friend String operator+(const String& a, const String& b) { return String(a.s_ + b.s_); }
    friend String operator+(const String& a, const char* b) { return String(a.s_ + (b ? b : "")); }
    friend String operator+(const char* a, const String& b) { return String(std::string(a ? a : "") + b.s_); }
    friend String operator+(const String& a, char b) { return String(a.s_ + b); }
    friend String operator+(const String& a, int b) { return String(a.s_ + num(b, 10)); }
    friend String operator+(const String& a, unsigned int b) { return String(a.s_ + num(b, 10)); }
    friend String operator+(const String& a, long b) { return String(a.s_ + num(b, 10)); }
    friend String operator+(const String& a, unsigned long b) { return String(a.s_ + num((long long)b, 10)); }

    bool operator==(const String& o) const { return s_ == o.s_; }
    bool operator==(const char* o) const { return s_ == (o ? o : ""); }
    bool operator!=(const String& o) const { return s_ != o.s_; }
    bool operator!=(const char* o) const { return s_ != (o ? o : ""); }
    bool operator<(const String& o) const { return s_ < o.s_; }
    bool equals(const String& o) const { return s_ == o.s_; }
    bool equals(const char* o) const { return s_ == (o ? o : ""); }
    bool equalsIgnoreCase(const String& o) const {
        if (s_.size() != o.s_.size()) return false;
        for (size_t i = 0; i < s_.size(); i++) if (tolower(s_[i]) != tolower(o.s_[i])) return false;
        return true;
    }
    int compareTo(const String& o) const { return s_.compare(o.s_); }

    bool startsWith(const String& p) const { return s_.rfind(p.s_, 0) == 0; }
    bool endsWith(const String& p) const {
        return s_.size() >= p.s_.size() && s_.compare(s_.size() - p.s_.size(), p.s_.size(), p.s_) == 0;
    }
    int indexOf(char c, unsigned int from = 0) const { auto p = s_.find(c, from); return p == std::string::npos ? -1 : (int)p; }
    int indexOf(const String& o, unsigned int from = 0) const { auto p = s_.find(o.s_, from); return p == std::string::npos ? -1 : (int)p; }
    int lastIndexOf(char c) const { auto p = s_.rfind(c); return p == std::string::npos ? -1 : (int)p; }
    String substring(unsigned int from) const { return from >= s_.size() ? String() : String(s_.substr(from)); }
    String substring(unsigned int from, unsigned int to) const {
        return from >= s_.size() || to <= from ? String() : String(s_.substr(from, to - from));
    }
    void replace(const String& a, const String& b) {
        if (a.s_.empty()) return;
        for (size_t p = 0; (p = s_.find(a.s_, p)) != std::string::npos; p += b.s_.size()) s_.replace(p, a.s_.size(), b.s_);
    }
    void remove(unsigned int idx, unsigned int count = 0xFFFFFFFF) { if (idx < s_.size()) s_.erase(idx, count); }
    void toLowerCase() { for (auto& c : s_) c = (char)tolower(c); }
    void toUpperCase() { for (auto& c : s_) c = (char)toupper(c); }
    void trim() {
        size_t b = s_.find_first_not_of(" \t\r\n");
        if (b == std::string::npos) { s_.clear(); return; }
        s_ = s_.substr(b, s_.find_last_not_of(" \t\r\n") - b + 1);
    }
    long toInt() const { return atol(s_.c_str()); }
    float toFloat() const { return (float)atof(s_.c_str()); }
    double toDouble() const { return atof(s_.c_str()); }
    void getBytes(unsigned char* buf, unsigned int n, unsigned int idx = 0) const {
        if (!n) return;
        if (idx >= s_.size()) { buf[0] = 0; return; }
        unsigned int c = (unsigned int)s_.size() - idx;
        if (c > n - 1) c = n - 1;
        memcpy(buf, s_.c_str() + idx, c);
        buf[c] = 0;
    }

private:
    static std::string num(long long v, unsigned char base) {
        if (base == 16) { char b[32]; snprintf(b, sizeof b, "%llx", (unsigned long long)v); return b; }
        return std::to_string(v);
    }
    static std::string flt(double v, unsigned char d) { char b[64]; snprintf(b, sizeof b, "%.*f", d, v); return b; }
    std::string s_;
};
