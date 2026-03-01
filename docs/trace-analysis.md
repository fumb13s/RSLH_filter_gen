# Chrome DevTools Trace Analysis

How to capture and analyze Chrome performance traces for DOM node leaks,
event listener accumulation, and memory pressure in the web UI.

## Capturing a trace

1. Open Chrome DevTools → **Performance** tab
2. Click the gear icon and enable **"Memory"** (shows counters for nodes,
   listeners, heap)
3. Click **Record**, interact with the app, then **Stop**
4. Export the trace: click the down-arrow → **Save profile…** → saves a
   `.json.gz` file

### What to record

For DOM leak analysis, the most useful interaction is **rapid pagination in
edit mode** with a large filter loaded (500+ rules). Click Next/Prev 10–20
times in quick succession — each page switch should ideally produce zero net
node/listener growth.

## Trace file format

The exported file is gzipped JSON with this structure:

```json
{
  "metadata": { ... },
  "traceEvents": [
    {
      "name": "UpdateCounters",
      "cat": "disabled-by-default-devtools.timeline",
      "ph": "I",
      "ts": 1993936597158,
      "pid": 3264,
      "tid": 42724,
      "args": {
        "data": {
          "documents": 5,
          "jsEventListeners": 1956,
          "jsHeapSizeUsed": 9426884,
          "nodes": 2718
        }
      }
    },
    ...
  ]
}
```

Key event types:

| Event name | What it tells you |
|---|---|
| `UpdateCounters` | Periodic snapshot: DOM node count, listener count, JS heap size |
| `EventDispatch` | User interaction (click, change, input, etc.) with duration |
| `FunctionCall` | JS function execution with source file, line, and duration |
| `MinorGC` / GC events | Garbage collection activity |

## Scripts

### Decompress the trace

```bash
cp /path/to/Trace-*.json.gz /tmp/
gunzip -k /tmp/Trace-*.json.gz
```

### 1. Overview: timeline of counters

Prints DOM nodes, event listeners, and heap size at ~2-second intervals.
This is the first script to run — it tells you immediately whether there's
a leak.

```python
import json

with open("/tmp/Trace-YYYYMMDDTHHMMSS.json") as f:
    data = json.load(f)

events = data["traceEvents"]

counters = []
for e in events:
    if e.get("name") == "UpdateCounters" and "data" in e.get("args", {}):
        d = e["args"]["data"]
        counters.append({
            "ts": e["ts"],
            "nodes": d.get("nodes", 0),
            "listeners": d.get("jsEventListeners", 0),
            "heap_mb": round(d.get("jsHeapSizeUsed", 0) / 1048576, 2),
            "documents": d.get("documents", 0),
        })

counters.sort(key=lambda x: x["ts"])

t0 = counters[0]["ts"]
for c in counters:
    c["t_sec"] = round((c["ts"] - t0) / 1e6, 2)

nodes = [c["nodes"] for c in counters]
listeners = [c["listeners"] for c in counters]
heap = [c["heap_mb"] for c in counters]

print(f"Duration: {counters[-1]['t_sec']:.1f} seconds")
print(f"Snapshots: {len(counters)}")
print()
print(f"DOM nodes:  min={min(nodes):,}  max={max(nodes):,}  start={nodes[0]:,}  end={nodes[-1]:,}")
print(f"Listeners:  min={min(listeners):,}  max={max(listeners):,}  start={listeners[0]:,}  end={listeners[-1]:,}")
print(f"Heap (MB):  min={min(heap):.1f}  max={max(heap):.1f}  start={heap[0]:.1f}  end={heap[-1]:.1f}")
print()

print("Time(s)  Nodes    Listeners  Heap(MB)")
print("-" * 48)
last_t = -999
for c in counters:
    if c["t_sec"] - last_t >= 2.0 or c == counters[-1]:
        print(f"{c['t_sec']:7.1f}  {c['nodes']:7,}  {c['listeners']:9,}  {c['heap_mb']:8.1f}")
        last_t = c["t_sec"]
```

**What to look for:** Monotonically increasing node/listener counts across
page switches means detached DOM nodes aren't being collected. A healthy
trace shows nodes staying roughly flat (old page collected, new page built).

### 2. User interactions

Lists every click, change, input, drag, and key event with its duration.
Use this to map "click #N" to a specific user action.

```python
import json

with open("/tmp/Trace-YYYYMMDDTHHMMSS.json") as f:
    data = json.load(f)

events = data["traceEvents"]
t0 = min(e["ts"] for e in events if e.get("name") == "UpdateCounters")

INTERACTION_TYPES = {
    "click", "change", "input", "mousedown", "mouseup",
    "keydown", "keyup", "drop", "dragstart", "dragend",
}

dispatches = []
for e in events:
    if e.get("name") == "EventDispatch" and "data" in e.get("args", {}):
        etype = e["args"]["data"].get("type", "")
        if etype in INTERACTION_TYPES:
            dispatches.append({
                "t_sec": round((e["ts"] - t0) / 1e6, 2),
                "type": etype,
                "dur_ms": round(e.get("dur", 0) / 1000, 1),
            })

dispatches.sort(key=lambda x: x["t_sec"])

print(f"User interactions: {len(dispatches)}")
print()
print("Time(s)  Type        Duration(ms)")
print("-" * 42)
for d in dispatches:
    print(f"{d['t_sec']:7.1f}  {d['type']:<12s} {d['dur_ms']:8.1f}")
```

### 3. Per-click node/listener deltas

The most diagnostic script. For each click, finds the counter snapshot
immediately before and after, then computes the delta. A consistent
`+97,707 nodes / +3,608 listeners` per click means per-card listeners
are leaking detached DOM.

```python
import json

with open("/tmp/Trace-YYYYMMDDTHHMMSS.json") as f:
    data = json.load(f)

events = data["traceEvents"]
t0 = min(e["ts"] for e in events if e.get("name") == "UpdateCounters")

counters = []
for e in events:
    if e.get("name") == "UpdateCounters" and "data" in e.get("args", {}):
        d = e["args"]["data"]
        counters.append({
            "ts": e["ts"],
            "nodes": d.get("nodes", 0),
            "listeners": d.get("jsEventListeners", 0),
        })
counters.sort(key=lambda x: x["ts"])

clicks = []
for e in events:
    if (e.get("name") == "EventDispatch"
            and e.get("args", {}).get("data", {}).get("type") == "click"):
        clicks.append({
            "t_sec": round((e["ts"] - t0) / 1e6, 2),
            "dur_ms": round(e.get("dur", 0) / 1000, 1),
            "ts": e["ts"],
        })
clicks.sort(key=lambda x: x["ts"])

hdr = (
    "Click#  Time(s)  Dur(ms)  "
    "Nodes_before -> Nodes_after  "
    "Listeners_before -> Listeners_after  "
    "Delta_nodes  Delta_listeners"
)
print(hdr)
print("-" * len(hdr))

for ci, click in enumerate(clicks):
    before = [c for c in counters if c["ts"] <= click["ts"]]
    after = [c for c in counters if c["ts"] > click["ts"] + click["dur_ms"] * 1000]
    if before and after:
        b, a = before[-1], after[0]
        dn = a["nodes"] - b["nodes"]
        dl = a["listeners"] - b["listeners"]
        print(
            f"  {ci+1:3d}   {click['t_sec']:6.1f}  {click['dur_ms']:7.1f}"
            f"  {b['nodes']:>10,} -> {a['nodes']:<10,}"
            f"  {b['listeners']:>8,} -> {a['listeners']:<8,}"
            f"  {dn:>+10,}  {dl:>+10,}"
        )
```

**What to look for:**

| Pattern | Meaning |
|---|---|
| `+97,707 nodes / +3,608 listeners` per click | Per-card listeners retaining closures over detached DOM (36 listeners x 100 cards) |
| `+N nodes / +0 listeners` per click | Nodes leak but listeners are delegated — check if old nodes have other GC roots |
| `~0 nodes / ~0 listeners` per click | Healthy: old page collected, new page replaces it |
| Sudden large negative delta | V8 GC reclaimed a batch of nodes under memory pressure |

### 4. Hot functions

Lists the longest-running JS function calls, showing which source file and
line triggered the work. Useful for identifying which click handler or
render function dominates.

```python
import json

with open("/tmp/Trace-YYYYMMDDTHHMMSS.json") as f:
    data = json.load(f)

events = data["traceEvents"]
t0 = min(e["ts"] for e in events if e.get("name") == "UpdateCounters")

MIN_DUR_US = 10_000  # 10ms threshold

func_calls = []
for e in events:
    if e.get("name") == "FunctionCall" and e.get("dur", 0) > MIN_DUR_US:
        d = e.get("args", {}).get("data", {})
        url = d.get("url", "")
        func_calls.append({
            "t_sec": round((e["ts"] - t0) / 1e6, 2),
            "dur_ms": round(e["dur"] / 1000, 1),
            "func": d.get("functionName", ""),
            "file": url.split("/")[-1].split("?")[0] if url else "",
            "line": d.get("lineNumber", ""),
        })

func_calls.sort(key=lambda x: -x["dur_ms"])

print(f"Function calls >{MIN_DUR_US // 1000}ms: {len(func_calls)}")
print()
print(f"{'Duration(ms)':>12s}  {'Time(s)':>7s}  {'Function':<30s} {'File:Line'}")
print("-" * 80)
for f in func_calls[:30]:
    loc = f"{f['file']}:{f['line']}" if f["file"] else ""
    print(f"{f['dur_ms']:12.1f}  {f['t_sec']:7.1f}  {f['func']:<30s} {loc}")
```

## Interpreting results

### Baseline (known-bad): main branch, pre-delegation

Trace `Trace-20260301T193041.json.gz` — edit mode, rapid pagination, 100
rules/page:

```
Duration: 17.8s, 26 clicks

DOM nodes:  min=2,718  max=1,372,886
Listeners:  min=1,667  max=33,100

Per page switch: +97,707 nodes, +3,608 listeners
```

Each page switch built 100 edit cards with ~36 `addEventListener` calls each.
The closures shared a context capturing both DOM elements and `rule` objects
(reachable via `currentFilter`), creating cross-heap reference cycles V8's GC
couldn't break. Nodes accumulated linearly until memory pressure forced a
collection (~click 18, -1.1M nodes).

The **+3,608 listeners/page** signature (36 x 100 cards) is the clearest
indicator of per-card listener leaks.

### Baseline (post-delegation): event-delegation branch

Trace `Trace-20260301T194212.json.gz` — same test: edit mode, rapid
pagination, 100 rules/page:

```
Duration: 17.6s, 29 clicks

DOM nodes:  min=1,750  max=673,205
Listeners:  min=110    max=1,990

Per page switch: +97,707 nodes, +8 listeners
```

| Metric | Pre-delegation | Post-delegation | Change |
|---|---|---|---|
| Peak listeners | 33,100 | 1,990 | **-94%** |
| Listener delta/click | +3,608 | +8 | **-99.8%** |
| Peak nodes | 1,372,886 | 673,205 | **-51%** |
| Node delta/click | +97,707 (retained) | +97,707 (GC-eligible) | Same build cost, different retention |
| GC reclamation | Only at ~1.3M pressure | Frequent batches (-250K to -310K) | Nodes actually collected |

**Listeners:** The +3,608 → +8 delta confirms delegation works. The ~8
residual per click are pagination button handlers wired via `AbortController`
signal, torn down on the next page switch. Steady-state hovers at 118–142.

**Nodes:** The per-page build cost is still +97,707 (100 edit cards × ~977
DOM elements each). The difference is retention: without closure references
pinning detached nodes, V8 can now collect them. The trace shows GC reclaiming
in batches (clicks 8–9, 12–13, 16–17, 22), keeping the peak at roughly half
the pre-delegation level. V8 doesn't GC synchronously on each page switch —
it batches when it decides to. This is normal, healthy behavior.

## Quick reference

```bash
# Decompress
gunzip -k /tmp/Trace-*.json.gz

# Run any script above
python3 script.py

# One-liner: peak nodes and listeners
python3 -c "
import json
d = json.load(open('/tmp/Trace-YYYYMMDDTHHMMSS.json'))
cs = [e['args']['data'] for e in d['traceEvents']
      if e.get('name') == 'UpdateCounters' and 'data' in e.get('args', {})]
print(f\"Peak nodes: {max(c['nodes'] for c in cs):,}\")
print(f\"Peak listeners: {max(c['jsEventListeners'] for c in cs):,}\")
"
```
