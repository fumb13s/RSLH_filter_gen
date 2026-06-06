// Extract inline <script> blocks from SellfileCreator.html, strip the giant
// base64 data: URIs (webp/wasm) so the remaining JS is small enough to beautify
// and read. Throwaway analysis tool; output lives in this gitignored dir.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../resources/SellfileCreator.html", import.meta.url);
const html = readFileSync(SRC, "utf8");

// Pull every <script ...>...</script> body, in document order.
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, blocks = [];
while ((m = re.exec(html))) blocks.push(m[1]);

let js = blocks.map((b, i) => `\n/* ===== inline <script> block #${i} ===== */\n${b}`).join("\n");
const beforeLen = js.length;

// Strip base64 payloads but keep the mime prefix so we know what was there.
let stripped = 0, bytes = 0;
js = js.replace(/(data:[a-z0-9.+/-]+;base64,)([A-Za-z0-9+/=]+)/gi, (_all, pre, b64) => {
  stripped++; bytes += b64.length;
  return pre + "<STRIPPED:" + b64.length + "b>";
});

const OUT = new URL("./gen/bundle.stripped.js", import.meta.url);
writeFileSync(OUT, js);
console.log(`script blocks: ${blocks.length}`);
console.log(`stripped ${stripped} base64 payloads (${(bytes/1e6).toFixed(2)} MB of base64)`);
console.log(`js size: ${(beforeLen/1e6).toFixed(2)} MB -> ${(js.length/1e6).toFixed(2)} MB after strip`);
console.log(`wrote ${OUT.pathname}`);
