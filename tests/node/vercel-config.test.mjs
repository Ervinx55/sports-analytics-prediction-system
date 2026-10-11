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

test("root Vercel project preserves current-master automatic Git deployments", () => {
  assert.equal(root?.git?.deploymentEnabled, undefined);
});

test("Edge Lab Vercel project only auto-deploys master", () => {
  assert.deepEqual(edgeLab?.git?.deploymentEnabled, {
    master: true,
    "*": false
  });
});
