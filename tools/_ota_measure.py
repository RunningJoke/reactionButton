#!/usr/bin/env python3
"""THROWAWAY spike (#122): OTA transfer measurements against the tOta... test ops. Prints JSON lines.

  _ota_measure.py info
  _ota_measure.py begin COM4 [--mode full|seq]
  _ota_measure.py usb COM3 --chunk 2048 [--nowrite]
  _ota_measure.py ble --chunk 2048 [--nowrite]
  _ota_measure.py pull SERVER_PORT CLIENT_PORT [--fps N] [--rate 24m] [--nowrite]
  _ota_measure.py bcast SENDER R1 R2 --pace 4000 [--rate 24m] [--fps N] [--nowrite] [--begin full]
  _ota_measure.py crc COM3 COM4 COM5
"""
import argparse, asyncio, base64, json, sys, threading, time, zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from reactpod_serial import PodSerial  # noqa: E402

BIN = Path(__file__).resolve().parent.parent / "firmware/.pio/build/NewBoard/firmware.bin"
SET_ID = "1895801b"


def out(kind, **kw):
    print(json.dumps({"run": kind, **kw}), flush=True)


def pod(port):
    p = PodSerial(port, show="none")
    p.start()
    if not p.connected.wait(10):
        raise SystemExit(f"{port} not available")
    return p


def bits_of(hexs):
    return int(hexs, 16) if hexs else 0


def stats(xs):
    xs = sorted(xs)
    return {"avg_ms": round(sum(xs) / len(xs) * 1000, 2), "p95_ms": round(xs[int(len(xs) * .95)] * 1000, 2),
            "max_ms": round(xs[-1] * 1000, 2)}


def cmd_info(a):
    for port in a.ports:
        p = pod(port)
        print(port, json.dumps(p.request("tOtaInfo")), flush=True)
        p.stop()


def cmd_begin(a):
    p = pod(a.port)
    t = time.time()
    r = p.request("tOtaBegin", timeout=120, mode=a.mode, size=BIN.stat().st_size)
    out("begin", port=a.port, mode=a.mode, wall_s=round(time.time() - t, 2), **r)
    p.stop()


def cmd_crc(a):
    data = BIN.read_bytes()
    out("crc_ref", crc="%08x" % zlib.crc32(data), size=len(data))
    for port in a.ports:
        p = pod(port)
        r1 = p.request("tOtaCrc", timeout=60, part="run", len=len(data))
        r2 = p.request("tOtaCrc", timeout=60, part="next", len=len(data))
        out("crc", port=port, run=r1["crc"], next=r2["crc"])
        p.stop()


def cmd_usb(a):
    data = BIN.read_bytes()
    p = pod(a.port)
    lat = []
    t0 = time.time()
    n = 0
    mx = 0
    for off in range(0, len(data), a.chunk):
        b = base64.b64encode(data[off:off + a.chunk]).decode()
        t = time.time()
        r = p.request("tOtaWrite", timeout=20, off=off, d=b, w=0 if a.nowrite else 1)
        lat.append(time.time() - t)
        n += 1
    el = time.time() - t0
    out("usb", port=a.port, chunk=a.chunk, write=not a.nowrite, requests=n, total_s=round(el, 2),
        kBps=round(len(data) / 1000 / el, 2), heap_min=r["heap"], **stats(lat))
    p.stop()


async def ble_run(a):
    from bleak import BleakScanner, BleakClient
    from reactpod_config import ReactPodConfig, is_reactpod, set_id_of
    data = BIN.read_bytes()
    dev = await BleakScanner.find_device_by_filter(lambda d, adv: is_reactpod(adv) and set_id_of(adv) == SET_ID, timeout=15)
    if dev is None:
        raise SystemExit("no ReactPod of the set found over BLE")
    async with BleakClient(dev) as client:
        cfg = ReactPodConfig(client)
        await cfg.start()
        if a.hold:   # keep the connection open (used by the pull tests): just idle
            await asyncio.sleep(a.hold)
            return
        lat = []
        t0 = time.time()
        for off in range(0, len(data), a.chunk):
            b = base64.b64encode(data[off:off + a.chunk]).decode()
            t = time.time()
            r = await cfg.request("tOtaWrite", off=off, d=b, w=0 if a.nowrite else 1)
            lat.append(time.time() - t)
        el = time.time() - t0
        out("ble", chunk=a.chunk, write=not a.nowrite, requests=len(lat), mtu=cfg.mtu, total_s=round(el, 2),
            kBps=round(len(data) / 1000 / el, 2), heap_min=r["heap"], **stats(lat))


def cmd_ble(a):
    asyncio.run(ble_run(a))


def run_async(p, op, results, key, timeout, **kw):
    def go():
        try:
            results[key] = p.request(op, timeout=timeout, **kw)
        except Exception as e:  # noqa
            results[key] = {"ok": False, "exc": str(e)}
    t = threading.Thread(target=go)
    t.start()
    return t


def cmd_pull(a):
    size = BIN.stat().st_size
    srv, cli = pod(a.server), pod(a.client)
    mac = srv.request("tOtaInfo")["mac"]
    res = {}
    kw = {"rate": a.rate} if a.rate else {}
    t1 = run_async(srv, "tOtaServe", res, "server", 400, secs=300, fps=a.fps, **kw)
    time.sleep(1.0)
    t0 = time.time()
    r = cli.request("tOtaPull", timeout=400, mac=mac, size=size, fps=a.fps, write=0 if a.nowrite else 1, tmo=a.tmo)
    wall = time.time() - t0
    t1.join(30)
    secs = r.get("totalUs", 0) / 1e6
    out("pull", server=a.server, client=a.client, fps=a.fps, rate=a.rate, write=not a.nowrite, wall_s=round(wall, 2),
        kBps=round(size / 1000 / secs, 2) if secs else None, client_r=r, server_r=res.get("server"))
    srv.stop(); cli.stop()


def cmd_bcast(a):
    size = BIN.stat().st_size
    snd = pod(a.sender)
    rcv = [pod(x) for x in a.receivers]
    kw = {"rate": a.rate} if a.rate else {}
    res = {}
    threads = []
    for i, r in enumerate(rcv):
        extra = {"begin": a.begin} if a.begin else {}
        threads.append(run_async(r, "tOtaRecv", res, f"r{i}", 400, size=size, fps=a.rfps, write=0 if a.nowrite else 1,
                                 wait=120, idle=3000, **extra))
    time.sleep(1.5)
    t0 = time.time()
    rs = snd.request("tOtaBcast", timeout=400, size=size, pace=a.pace, fps=a.fps, **kw)
    wall = time.time() - t0
    for t in threads:
        t.join(60)
    N = rs["N"]
    full = (1 << N) - 1
    got = []
    summary = []
    for i in range(len(rcv)):
        r = res[f"r{i}"]
        raw = bytes.fromhex(r["bits"])
        v = int.from_bytes(raw, "little")
        got.append(v)
        miss = N - bin(v).count("1")
        summary.append({"port": a.receivers[i], "count": r.get("count"), "lost": miss, "loss_pct": round(100 * miss / N, 2),
                        "maxGapUs": r.get("maxGapUs"), "writeMaxUs": r.get("writeMaxUs"), "writeAvgUs": r.get("writeAvgUs"),
                        "writeErrs": r.get("writeErrs"), "skipped": r.get("skipped"), "heapMin": r.get("heapMin"),
                        "ledTicks": r.get("ledTicks"), "ended": r.get("ended"),
                        **{k: r[k] for k in ("beginMs", "beginErr", "dFrames", "dMin", "dMax", "dGapUs", "dLed") if k in r}})
    both_lost = full & ~got[0] & ~got[1] if len(got) == 2 else None
    any_lost = full & ~(got[0] & got[1]) if len(got) == 2 else None
    extra = {}
    if len(got) == 2:
        extra = {"lost_by_both": bin(both_lost).count("1"), "repair_union": bin(any_lost).count("1"),
                 "only_r0": bin(full & ~got[0] & got[1]).count("1"), "only_r1": bin(full & ~got[1] & got[0]).count("1")}
    out("bcast", pace_us=a.pace, rate=a.rate, fps=a.fps, rfps=a.rfps, write=not a.nowrite, begin=a.begin, wall_s=round(wall, 2),
        send_s=round(rs["totalUs"] / 1e6, 2), kBps_sent=round(size / 1000 / (rs["totalUs"] / 1e6), 2), sender=rs,
        receivers=summary, **extra)
    snd.stop()
    for r in rcv:
        r.stop()


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("info"); s.add_argument("ports", nargs="+"); s.set_defaults(f=cmd_info)
    s = sp.add_parser("crc"); s.add_argument("ports", nargs="+"); s.set_defaults(f=cmd_crc)
    s = sp.add_parser("begin"); s.add_argument("port"); s.add_argument("--mode", default="full"); s.set_defaults(f=cmd_begin)
    s = sp.add_parser("usb"); s.add_argument("port"); s.add_argument("--chunk", type=int, default=2048)
    s.add_argument("--nowrite", action="store_true"); s.set_defaults(f=cmd_usb)
    s = sp.add_parser("ble"); s.add_argument("--chunk", type=int, default=2048); s.add_argument("--hold", type=float, default=0)
    s.add_argument("--nowrite", action="store_true"); s.set_defaults(f=cmd_ble)
    s = sp.add_parser("pull"); s.add_argument("server"); s.add_argument("client"); s.add_argument("--fps", type=int, default=0)
    s.add_argument("--rate", default=""); s.add_argument("--tmo", type=int, default=30); s.add_argument("--nowrite", action="store_true")
    s.set_defaults(f=cmd_pull)
    s = sp.add_parser("bcast"); s.add_argument("sender"); s.add_argument("receivers", nargs="+")
    s.add_argument("--pace", type=int, default=4000); s.add_argument("--rate", default="")
    s.add_argument("--fps", type=int, default=0); s.add_argument("--rfps", type=int, default=0)
    s.add_argument("--nowrite", action="store_true"); s.add_argument("--begin", default="")
    s.set_defaults(f=cmd_bcast)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
