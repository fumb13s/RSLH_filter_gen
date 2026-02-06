import { generateFilter, serializeFilter, defaultRule } from "@rslh/core";
import "./style.css";

const filter = generateFilter([defaultRule()]);
const compactJson = serializeFilter(filter);
const prettyJson = JSON.stringify(filter, null, 2);

const outputPre = document.getElementById("output")!;
outputPre.textContent = prettyJson;

const downloadBtn = document.getElementById("download")!;
downloadBtn.addEventListener("click", () => {
  const blob = new Blob([compactJson], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filter.hsf";
  a.click();
  URL.revokeObjectURL(url);
});
