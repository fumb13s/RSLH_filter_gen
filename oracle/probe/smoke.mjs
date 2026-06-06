// Headless smoke test: boot Sellfile Creator's EVAL WORKER in plain Node — no
// browser, no Chromium, no worker_threads — just a `self` shim + WebAssembly.
// Proves we can drive the evaluator's pipeline (init-wasm -> pipeline -> done).
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./gen/worker-eval.full.js", import.meta.url), "utf8");
const CANDIDATE_WASM = ["wasm-2-659730.wasm", "wasm-0-1620221.wasm", "wasm-1-224216.wasm"];

function makeShim(outbox) {
  return {
    name: "",
    location: { href: "file:///sfc/worker-eval.js" },
    onmessage: null,
    onerror: null,
    postMessage: (m) => outbox.push(m),
    addEventListener() {}, removeEventListener() {}, close() {},
  };
}

async function tryWasm(file) {
  const outbox = [];
  const self = makeShim(outbox);
  globalThis.self = self;
  (0, eval)(SRC); // runs the worker IIFE; it sets self.onmessage
  if (typeof self.onmessage !== "function") throw new Error("worker did not install onmessage");

  const mod = new WebAssembly.Module(readFileSync(new URL(`./gen/${file}`, import.meta.url)));
  await self.onmessage({ data: { kind: "init-wasm", wasmModule: mod } });

  const payload = {
    hsf: { Rules: [] },
    recipes: [], metasets: [], substatTargets: [],
    safeguards: { enabled: false, rules: [], detection: null },
    artifacts: [],
    generation: 1, emitProgressEvents: false,
  };
  const done = new Promise((res) => {
    const t = setInterval(() => {
      const d = outbox.find((m) => m && (m.kind === "pipeline:done" || m.kind === "pipeline:error"));
      if (d) { clearInterval(t); res(d); }
    }, 5);
    setTimeout(() => { clearInterval(t); res({ kind: "TIMEOUT" }); }, 8000);
  });
  await self.onmessage({ data: { id: 1, kind: "pipeline", payload } });
  const result = await done;
  return { file, kinds: outbox.map((m) => m && m.kind), result };
}

for (const w of CANDIDATE_WASM) {
  try {
    const r = await tryWasm(w);
    console.log(`\n[${w}] postMessage kinds: ${JSON.stringify(r.kinds)}`);
    if (r.result.kind === "pipeline:done") {
      const p = r.result.payload || {};
      console.log(`  ✅ pipeline:done  matches=${(p.matches || []).length}  mergedRules=${(p.mergedRules || []).length}  wasmBytes=${p.wasmLinearBytes}`);
      console.log("  >>> HEADLESS EVAL WORKS IN PLAIN NODE (no browser) <<<");
      break;
    } else {
      console.log(`  result: ${JSON.stringify(r.result).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`\n[${w}] threw: ${e && e.message ? e.message : e}`);
  }
}
