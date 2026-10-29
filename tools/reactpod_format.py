"""
Output formatting shared by the reference clients (reactpod_serial.py and reactpod_config.py).
"""


def report_line(report: dict) -> str:
    """One line per `report` event (config-api.md §5): id, cycle, program, duration, metric statistics, variables."""
    duration = (report.get("endMs", 0) - report.get("startMs", 0)) / 1000
    head = f"[report {report.get('id')}] cycle {report.get('cycle')} {report.get('program')} {duration:.1f} s"
    if report.get("athlete"):
        head += f" athlete {report['athlete']}"
    stats = [f"{metric} {s.get('count')}x avg {s.get('average')} best {s.get('best')} worst {s.get('worst')}"
             for metric, s in report.get("stats", {}).items()]
    variables = [f"{name}={value}" for name, value in report.get("vars", {}).items()]
    body = "; ".join(stats + variables)
    tail = f"  ({report['valuesDropped']} values dropped)" if report.get("valuesDropped") else ""
    return head + (f"  {body}" if body else "") + tail
