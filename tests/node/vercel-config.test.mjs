import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = JSON.parse(
  fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
);
const edgeLab = JSON.parse(
  fs.readFileSync(
    new URL("../../sharp-service/vercel.json", import.meta.url),
    "utf8"
  )
);

test("legacy root Vercel project has automatic deployments disabled", () => {
  assert.equal(root?.git?.deploymentEnabled, false);
});

test("Edge Lab Vercel project only auto-deploys master", () => {
  assert.deepEqual(edgeLab?.git?.deploymentEnabled, {
    master: true,
    "*": false
  });
});

test("Hobby deployment keeps at most 12 API serverless functions",()=>{
  const apiDir = new URL("../../sharp-service/api/", import.meta.url);
  const handlers = fs.readdirSync(apiDir).filter(name=>name.endsWith(".js"));
  assert.ok(handlers.length <= 12, "Hobby permits at most 12 functions; found "+handlers.length);
  assert.equal(handlers.includes("edge-vnext.js"),false);
  assert.deepEqual(edgeLab.rewrites.find(rule=>rule.source==="/api/edge-vnext"),{
    source:"/api/edge-vnext",destination:"/api/dashboard?edgeVnext=1"
  });
  assert.ok(!edgeLab.functions["api/edge-vnext.js"]);
});
