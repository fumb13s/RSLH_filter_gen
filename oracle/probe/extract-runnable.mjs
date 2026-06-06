// Extract the RUNNABLE eval worker (un-stripped, real wasm/webp intact) and the
// raw wasm blobs from the ORIGINAL minified html, for a headless Node smoke test.
import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync(new URL("../resources/SellfileCreator.html", import.meta.url), "utf8");

const idChar = (c) => c && /[A-Za-z0-9_$]/.test(c);
// Find `name = '...'` / `name="..."` and return the (still-quoted) JS string literal.
function literalAfter(name) {
  let idx = 0;
  while ((idx = html.indexOf(name, idx)) >= 0) {
    if (idChar(html[idx - 1])) { idx += name.length; continue; }
    let j = idx + name.length;
    while (html[j] === " ") j++;
    if (html[j] !== "=") { idx += name.length; continue; }
    j++;
    while (html[j] === " ") j++;
    const q = html[j];
    if (q !== "'" && q !== '"') { idx += name.length; continue; }
    let k = j + 1, s = "";
    while (k < html.length) {
      const c = html[k];
      if (c === "\\") { s += c + html[k + 1]; k += 2; continue; }
      if (c === q) return q + s + q;
      s += c; k++;
    }
    idx += name.length;
  }
  return null;
}

for (const [out, name] of [["worker-eval.full", "GmA"], ["worker-parse.full", "M$"]]) {
  const lit = literalAfter(name);
  if (!lit) { console.log(`!! ${name}: not found`); continue; }
  const code = (0, eval)(lit);
  writeFileSync(new URL(`./gen/${out}.js`, import.meta.url), code);
  console.log(`${out}.js: ${(code.length / 1024).toFixed(1)} KB`);
}

const re = /data:application\/wasm;base64,([A-Za-z0-9+/=]+)/g;
let m, i = 0;
while ((m = re.exec(html))) {
  const buf = Buffer.from(m[1], "base64");
  const f = `wasm-${i}-${buf.length}.wasm`;
  writeFileSync(new URL(`./gen/${f}`, import.meta.url), buf);
  console.log(`${f}: ${(buf.length / 1024).toFixed(1)} KB`);
  i++;
}
