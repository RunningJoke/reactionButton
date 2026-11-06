#include "OtaTest.h"
#include <Arduino.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_wifi.h>
#include <esp_bt.h>
#include <esp_timer.h>
#include <esp_rom_crc.h>
#include <mbedtls/base64.h>
#include <WiFi.h>
#include <vector>
#include "Link/EspNowLink.h"
#include "Link/Protocol.h"
#include "LEDManager/LEDManager.h"
#include "Roles/RoleManager.h"

// THROWAWAY spike (#122). Test frames reuse the header; types are outside Protocol::MsgType.
namespace {
    using Protocol::Header;
    const uint8_t T_REQ = 100, T_RESP = 101, T_BDATA = 102, T_BEND = 103, T_DONE = 104;

    struct __attribute__((packed)) Req { Header h; uint32_t off; };
    struct __attribute__((packed)) Resp { Header h; uint32_t off; uint8_t len; uint8_t data[200]; };
    struct __attribute__((packed)) BData { Header h; uint32_t n; uint8_t len; uint8_t data[236]; };
    struct __attribute__((packed)) BEnd { Header h; uint32_t total; };

    void fill(Header& h, uint8_t type) {
        Protocol::fillHeader(h, (Protocol::MsgType)type, 0);
    }
    uint8_t typeOf(const RxFrame& f) { return (uint8_t)reinterpret_cast<const Header*>(f.data)->type; }

    esp_ota_handle_t handle = 0;
    bool open = false;
    bool seqMode = false;
    const esp_partition_t* nextPart = nullptr;
    volatile int beginState = 0;     // 0 idle, 1 running, 2 done, 3 error
    volatile uint32_t beginMs = 0;
    volatile int beginErr = 0;
    size_t beginSize = 0;

    // loop-gap tracker and LED ring refresh at a chosen frame rate
    struct Probe {
        int64_t last = 0, nextLed = 0;
        uint32_t maxGapUs = 0, ledTicks = 0;
        uint8_t fps = 0, phase = 0;
        void tick() {
            int64_t now = esp_timer_get_time();
            if(last != 0 && (uint32_t)(now - last) > maxGapUs) maxGapUs = (uint32_t)(now - last);
            last = now;
            if(fps != 0 && now >= nextLed) {
                nextLed = now + 1000000 / fps;
                ledTicks++;
                LEDManager::getManager()->setSegment(phase++ % NEOPIXEL_SIZE, 3, Protocol::Color::BLUE, Protocol::Color::OFF);
            }
        }
        void end() { if(fps != 0) LEDManager::getManager()->turnOff(); }
    };

    void heapInfo(JsonDocument& r) {
        r["heap"] = esp_get_free_heap_size();
        r["heapMin"] = esp_get_minimum_free_heap_size();
    }

    bool parseMac(const char* s, uint8_t* mac) {
        if(s == nullptr || strlen(s) != 12) return false;
        for(int i = 0; i < 6; i++) {
            char b[3] = {s[2 * i], s[2 * i + 1], 0};
            mac[i] = (uint8_t)strtoul(b, nullptr, 16);
        }
        return true;
    }

    void setRate(JsonObjectConst req, JsonDocument& r) {
        const char* name = req["rate"] | "";
        if(!*name) return;
        wifi_phy_rate_t rate = WIFI_PHY_RATE_1M_L;
        if(!strcmp(name, "2m")) rate = WIFI_PHY_RATE_2M_L;
        else if(!strcmp(name, "11m")) rate = WIFI_PHY_RATE_11M_L;
        else if(!strcmp(name, "6m")) rate = WIFI_PHY_RATE_6M;
        else if(!strcmp(name, "12m")) rate = WIFI_PHY_RATE_12M;
        else if(!strcmp(name, "24m")) rate = WIFI_PHY_RATE_24M;
        else if(!strcmp(name, "54m")) rate = WIFI_PHY_RATE_54M;
        else if(!strcmp(name, "mcs0")) rate = WIFI_PHY_RATE_MCS0_LGI;
        else if(!strcmp(name, "mcs7")) rate = WIFI_PHY_RATE_MCS7_LGI;
        r["rateErr"] = (int)esp_wifi_config_espnow_rate(WIFI_IF_STA, rate);
    }

    void beginTask(void*) {
        int64_t t0 = esp_timer_get_time();
        if(open) { esp_ota_abort(handle); open = false; }
        esp_err_t err = esp_ota_begin(nextPart, seqMode ? OTA_WITH_SEQUENTIAL_WRITES : beginSize, &handle);
        beginMs = (uint32_t)((esp_timer_get_time() - t0) / 1000);
        beginErr = (int)err;
        open = err == ESP_OK;
        beginState = err == ESP_OK ? 2 : 3;
        vTaskDelete(nullptr);
    }

    void startBegin(const char* mode, size_t size) {
        nextPart = esp_ota_get_next_update_partition(nullptr);
        seqMode = !strcmp(mode, "seq");
        beginSize = size;
        beginState = 1;
        xTaskCreate(beginTask, "otabegin", 4096, nullptr, 1, nullptr);
    }

    bool writeAt(uint32_t off, const uint8_t* data, size_t len, uint32_t& us, esp_err_t& err) {
        int64_t t0 = esp_timer_get_time();
        err = seqMode ? esp_ota_write(handle, data, len) : esp_ota_write_with_offset(handle, data, len, off);
        us = (uint32_t)(esp_timer_get_time() - t0);
        return err == ESP_OK;
    }

    uint32_t crcOf(const esp_partition_t* p, size_t len) {
        static uint8_t buf[4096];
        uint32_t crc = 0;
        for(size_t off = 0; off < len; off += sizeof(buf)) {
            size_t n = len - off < sizeof(buf) ? len - off : sizeof(buf);
            esp_partition_read(p, off, buf, n);
            crc = esp_rom_crc32_le(crc, buf, n);
        }
        return crc;
    }

    // ---- ops

    void opInfo(JsonDocument& r) {
        uint8_t mac[6];
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        char m[13];
        snprintf(m, sizeof m, "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        r["mac"] = m;
        IRole* role = RoleManager::getManager()->current();
        r["role"] = role ? role->name() : "?";
        const esp_partition_t* run = esp_ota_get_running_partition();
        const esp_partition_t* nxt = esp_ota_get_next_update_partition(nullptr);
        r["run"] = run->label; r["runOff"] = run->address;
        r["next"] = nxt->label; r["nextOff"] = nxt->address; r["nextSize"] = nxt->size;
        r["bt"] = (int)esp_bt_controller_get_status();
        wifi_ps_type_t ps; esp_wifi_get_ps(&ps); r["ps"] = (int)ps;
        uint8_t ch; wifi_second_chan_t sc; esp_wifi_get_channel(&ch, &sc); r["ch"] = ch;
        heapInfo(r);
        r["ok"] = true;
    }

    void opBegin(JsonObjectConst req, JsonDocument& r) {
        startBegin(req["mode"] | "full", req["size"] | 1150000);
        if(!(req["async"] | 0)) {
            int64_t t0 = esp_timer_get_time();
            while(beginState == 1) vTaskDelay(1);
            r["wallMs"] = (uint32_t)((esp_timer_get_time() - t0) / 1000);
            r["beginMs"] = beginMs; r["err"] = beginErr;
        }
        heapInfo(r);
        r["ok"] = true;
    }

    void opStatus(JsonDocument& r) {
        r["state"] = beginState; r["beginMs"] = beginMs; r["err"] = beginErr; r["open"] = open;
        heapInfo(r);
        r["ok"] = true;
    }

    void opWrite(JsonObjectConst req, JsonDocument& r) {
        static uint8_t buf[3300];
        const char* d = req["d"] | "";
        size_t olen = 0;
        int rc = mbedtls_base64_decode(buf, sizeof buf, &olen, (const unsigned char*)d, strlen(d));
        if(rc != 0) { r["ok"] = false; r["error"] = "b64"; r["rc"] = rc; return; }
        uint32_t us = 0; esp_err_t err = ESP_OK;
        if((req["w"] | 1) && open) writeAt(req["off"] | 0, buf, olen, us, err);
        r["n"] = (uint32_t)olen; r["us"] = us; r["err"] = (int)err;
        r["heap"] = esp_get_free_heap_size();
        r["ok"] = true;
    }

    void opEnd(JsonDocument& r) {
        int64_t t0 = esp_timer_get_time();
        esp_err_t err = open ? esp_ota_end(handle) : ESP_FAIL;
        open = false;
        r["endMs"] = (uint32_t)((esp_timer_get_time() - t0) / 1000); r["err"] = (int)err;
        r["ok"] = true;
    }

    void opCrc(JsonObjectConst req, JsonDocument& r) {
        const esp_partition_t* p = !strcmp(req["part"] | "run", "run") ? esp_ota_get_running_partition()
                                                                      : esp_ota_get_next_update_partition(nullptr);
        int64_t t0 = esp_timer_get_time();
        char c[9]; snprintf(c, sizeof c, "%08x", (unsigned)crcOf(p, req["len"] | 0));
        r["crc"] = c; r["ms"] = (uint32_t)((esp_timer_get_time() - t0) / 1000); r["ok"] = true;
    }

    // pull server: answers REQ frames with 200 byte chunks of the running image
    void opServe(JsonObjectConst req, JsonDocument& r) {
        EspNowLink& link = EspNowLink::get();
        setRate(req, r);
        const esp_partition_t* run = esp_ota_get_running_partition();
        uint32_t secs = req["secs"] | 60;
        Probe probe; probe.fps = req["fps"] | 0;
        uint32_t reqs = 0;
        int64_t end = esp_timer_get_time() + (int64_t)secs * 1000000;
        RxFrame f;
        while(esp_timer_get_time() < end) {
            probe.tick();
            link.service();
            if(!link.receive(f)) { link.idleWait(1); continue; }
            uint8_t t = typeOf(f);
            if(t == T_DONE) break;
            if(t != T_REQ || f.len < sizeof(Req)) continue;
            const Req* q = reinterpret_cast<const Req*>(f.data);
            Resp resp; fill(resp.h, T_RESP);
            resp.off = q->off; resp.len = 200;
            esp_partition_read(run, q->off, resp.data, 200);
            link.send(f.mac, &resp, sizeof(resp), 3);
            reqs++;
        }
        probe.end();
        r["reqs"] = reqs; r["maxGapUs"] = probe.maxGapUs; r["ledTicks"] = probe.ledTicks;
        heapInfo(r); r["ok"] = true;
    }

    // pull client: stop-and-wait, one REQ at a time, writes to the inactive slot
    void opPull(JsonObjectConst req, JsonDocument& r) {
        EspNowLink& link = EspNowLink::get();
        uint8_t mac[6];
        if(!parseMac(req["mac"] | "", mac)) { r["ok"] = false; r["error"] = "mac"; return; }
        uint32_t size = req["size"] | 1150000, chunk = 200;
        bool write = (req["write"] | 1) && open;
        uint32_t tmoUs = (req["tmo"] | 30) * 1000;
        Probe probe; probe.fps = req["fps"] | 0;
        uint32_t timeouts = 0, writeMaxUs = 0, writeErrs = 0, chunks = 0, stale = 0;
        bool failed = false;
        setRate(req, r);
        link.resetStats();
        RxFrame f;
        int64_t t0 = esp_timer_get_time();
        uint32_t consecutive = 0;
        for(uint32_t off = 0; off < size && !failed;) {
            Req q; fill(q.h, T_REQ); q.off = off;
            link.send(mac, &q, sizeof(q), 3);
            int64_t deadline = esp_timer_get_time() + tmoUs;
            bool got = false;
            while(esp_timer_get_time() < deadline && !got) {
                probe.tick();
                link.service();
                if(!link.receive(f)) { link.idleWait(1); continue; }
                if(typeOf(f) != T_RESP || f.len < sizeof(Resp)) continue;
                const Resp* p = reinterpret_cast<const Resp*>(f.data);
                if(p->off != off) { stale++; continue; }
                uint32_t n = size - off < chunk ? size - off : chunk;
                if(write) {
                    uint32_t us; esp_err_t err;
                    if(!writeAt(off, p->data, n, us, err)) writeErrs++;
                    if(us > writeMaxUs) writeMaxUs = us;
                }
                off += n; chunks++; got = true;
            }
            if(!got) {
                timeouts++;
                if(++consecutive > 100) failed = true;
            } else consecutive = 0;
        }
        uint32_t totalUs = (uint32_t)(esp_timer_get_time() - t0);
        probe.end();
        Header d; fill(d, T_DONE);
        link.send(mac, &d, sizeof(d), 3);
        for(int i = 0; i < 20; i++) { link.service(); vTaskDelay(1); }
        EspNowLink::LinkStats st;
        if(link.stats(mac, st)) {
            r["txFrames"] = st.txFrames; r["txRetries"] = st.txRetries; r["txLost"] = st.txLost;
            r["avgAckUs"] = st.avgAckUs; r["maxAckUs"] = st.maxAckUs;
        }
        r["chunks"] = chunks; r["timeouts"] = timeouts; r["stale"] = stale; r["failed"] = failed;
        r["totalUs"] = totalUs; r["writeMaxUs"] = writeMaxUs; r["writeErrs"] = writeErrs;
        r["maxGapUs"] = probe.maxGapUs; r["ledTicks"] = probe.ledTicks;
        heapInfo(r); r["ok"] = true;
    }

    // broadcast sender: frames n = 0..N-1 paced, then END
    void opBcast(JsonObjectConst req, JsonDocument& r) {
        EspNowLink& link = EspNowLink::get();
        const esp_partition_t* run = esp_ota_get_running_partition();
        uint32_t size = req["size"] | 1150000, chunk = req["chunk"] | 200, paceUs = req["pace"] | 4000;
        uint32_t N = (size + chunk - 1) / chunk;
        Probe probe; probe.fps = req["fps"] | 0;
        setRate(req, r);
        uint32_t okBefore = EspNowLink::bcastOk, failBefore = EspNowLink::bcastFail;
        uint32_t sendErr = 0;
        int64_t t0 = esp_timer_get_time(), next = t0;
        for(uint32_t n = 0; n < N; n++) {
            BData b; fill(b.h, T_BDATA);
            b.n = n; b.len = chunk;
            esp_partition_read(run, n * chunk, b.data, chunk);
            int64_t now;
            while((now = esp_timer_get_time()) < next) {
                probe.tick();
                if(next - now > 1500) vTaskDelay(1);
            }
            if(now - next > 50000) next = now;      // fell far behind: do not burst
            next += paceUs;
            int tries = 0;
            while(!link.broadcast(&b, sizeof(Header) + 5 + chunk)) {
                sendErr++; probe.tick(); vTaskDelay(1);
                if(++tries > 200) break;
            }
            probe.tick();
        }
        uint32_t totalUs = (uint32_t)(esp_timer_get_time() - t0);
        for(int i = 0; i < 10; i++) {
            BEnd e; fill(e.h, T_BEND); e.total = N;
            link.broadcast(&e, sizeof(e));
            vTaskDelay(5);
        }
        probe.end();
        r["N"] = N; r["totalUs"] = totalUs; r["sendErr"] = sendErr;
        r["cbOk"] = EspNowLink::bcastOk - okBefore; r["cbFail"] = EspNowLink::bcastFail - failBefore;
        r["maxGapUs"] = probe.maxGapUs; r["ledTicks"] = probe.ledTicks;
        heapInfo(r); r["ok"] = true;
    }

    // broadcast receiver: bitmap of chunks, optional flash writes, optional begin in the background
    void opRecv(JsonObjectConst req, JsonDocument& r) {
        EspNowLink& link = EspNowLink::get();
        uint32_t size = req["size"] | 1150000, chunk = req["chunk"] | 200;
        uint32_t N = (size + chunk - 1) / chunk;
        bool write = req["write"] | 1;
        uint32_t waitSecs = req["wait"] | 60, idleMs = req["idle"] | 3000;
        const char* beginMode = req["begin"] | "";
        Probe probe; probe.fps = req["fps"] | 0;
        std::vector<uint8_t> bits((N + 7) / 8, 0);
        uint32_t count = 0, firstN = 0xFFFFFFFF, lastN = 0, writeMaxUs = 0, writeErrs = 0, skipped = 0, nextSeqN = 0;
        uint64_t writeSumUs = 0; uint32_t writes = 0;
        uint32_t dFrames = 0, dMin = 0xFFFFFFFF, dMax = 0, dGapUs = 0, dLed = 0;
        bool inBegin = false;
        if(*beginMode) { startBegin(beginMode, size); inBegin = true; }
        int64_t startWait = esp_timer_get_time(), lastRx = 0;
        RxFrame f;
        bool ended = false;
        while(!ended) {
            int64_t now = esp_timer_get_time();
            if(lastRx == 0 && now - startWait > (int64_t)waitSecs * 1000000) break;
            if(lastRx != 0 && now - lastRx > (int64_t)idleMs * 1000) break;
            probe.tick();
            if(inBegin && probe.maxGapUs > dGapUs) dGapUs = probe.maxGapUs;
            if(inBegin && beginState != 1) { inBegin = false; dLed = probe.ledTicks; }
            link.service();
            if(!link.receive(f)) { link.idleWait(1); continue; }
            uint8_t t = typeOf(f);
            if(t == T_BEND) { ended = true; break; }
            if(t != T_BDATA || f.len < sizeof(Header) + 5) continue;
            const BData* b = reinterpret_cast<const BData*>(f.data);
            lastRx = esp_timer_get_time();
            if(b->n >= N) continue;
            if(b->n < firstN) firstN = b->n;
            if(b->n > lastN) lastN = b->n;
            if(inBegin) { dFrames++; if(b->n < dMin) dMin = b->n; if(b->n > dMax) dMax = b->n; }
            if(bits[b->n >> 3] & (1 << (b->n & 7))) continue;
            bits[b->n >> 3] |= 1 << (b->n & 7);
            count++;
            if(write && open && !inBegin) {
                uint32_t us; esp_err_t err;
                if(seqMode && b->n != nextSeqN) { skipped++; continue; }
                if(!writeAt(b->n * chunk, b->data, b->len, us, err)) writeErrs++;
                nextSeqN = b->n + 1;
                if(us > writeMaxUs) writeMaxUs = us;
                writeSumUs += us; writes++;
            }
        }
        probe.end();
        std::string hex; hex.reserve(bits.size() * 2);
        for(uint8_t v : bits) { char h[3]; snprintf(h, sizeof h, "%02x", v); hex += h; }
        r["N"] = N; r["count"] = count; r["firstN"] = (int)(firstN == 0xFFFFFFFF ? -1 : (int)firstN); r["lastN"] = lastN;
        r["ended"] = ended; r["bits"] = hex;
        r["writeMaxUs"] = writeMaxUs; r["writeAvgUs"] = writes ? (uint32_t)(writeSumUs / writes) : 0;
        r["writeErrs"] = writeErrs; r["skipped"] = skipped;
        r["maxGapUs"] = probe.maxGapUs; r["ledTicks"] = probe.ledTicks;
        if(*beginMode) {
            r["beginMs"] = beginMs; r["beginErr"] = beginErr; r["beginState"] = beginState;
            r["dFrames"] = dFrames; r["dMin"] = dMin == 0xFFFFFFFF ? 0 : dMin; r["dMax"] = dMax;
            r["dGapUs"] = dGapUs; r["dLed"] = dLed;
        }
        heapInfo(r); r["ok"] = true;
    }
}

bool OtaTest::handle(const char* op, JsonObjectConst req, JsonDocument& res) {
    if(strncmp(op, "tOta", 4) != 0) return false;
    const char* name = op + 4;
    if(!strcmp(name, "Info")) opInfo(res);
    else if(!strcmp(name, "Begin")) opBegin(req, res);
    else if(!strcmp(name, "Status")) opStatus(res);
    else if(!strcmp(name, "Write")) opWrite(req, res);
    else if(!strcmp(name, "End")) opEnd(res);
    else if(!strcmp(name, "Crc")) opCrc(req, res);
    else if(!strcmp(name, "Serve")) opServe(req, res);
    else if(!strcmp(name, "Pull")) opPull(req, res);
    else if(!strcmp(name, "Bcast")) opBcast(req, res);
    else if(!strcmp(name, "Recv")) opRecv(req, res);
    else { res["ok"] = false; res["error"] = "bad_request"; }
    return true;
}
