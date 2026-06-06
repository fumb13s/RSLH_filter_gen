// Pull the two inline Web Worker source strings (M$ = file-parse, GmA = eval)
// out of the beautified bundle and write them as standalone .js for reading.
// Source is the asset-STRIPPED pretty bundle, so embedded wasm is a stub — fine
// for understanding the protocol/logic (not for execution).
import { readFileSync, writeFileSync } from "node:fs";

const js = readFileSync(new URL("./gen/bundle.pretty.js", import.meta.url), "utf8");

// Match a single-quoted JS string literal (handles \' and \\ escapes).
function literalAfter(marker) {
  const i = js.indexOf(marker);
  if (i < 0) return null;
  const start = js.indexOf("'", i + marker.length - 1);
  const re = /'(?:[^'\\]|\\.)*'/g;
  re.lastIndex = start;
  const m = re.exec(js);
  return m ? m[0] : null;
}

for (const [name, marker] of [["worker-parse", "M$ = '"], ["worker-eval", "GmA = '"]]) {
  const lit = literalAfter(marker);
  if (!lit) { console.log(`!! ${name}: literal not found`); continue; }
  const code = (0, eval)(lit); // unescape \n \t \' -> readable worker source
  const out = new URL(`./gen/${name}.js`, import.meta.url);
  writeFileSync(out, code);
  console.log(`${name}.js: ${(code.length / 1024).toFixed(1)} KB  (lines: ${code.split("\n").length})`);
}
