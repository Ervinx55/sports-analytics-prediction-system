import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import modelHandler from "../../sharp-service/api/models.js";

const root = JSON.parse(
  fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
);
const edgeLab = JSON.parse(
  fs.readFileSync(
    new URL("../../sharp-service/vercel.json", import.meta.url),
    "utf8"
  )
);

test("Edge Lab fits the Hobby serverless function limit", () => {
  const functions = fs.readdirSync(new URL("../../sharp-service/api/", import.meta.url))
    .filter((name) => /\.[cm]?js$/.test(name));
  assert.ok(functions.length <= 12, `${functions.length} functions exceed the 12-function limit`);
});

test("consolidated model routes preserve method rejection and reject unknown routes", async () => {
  for (const route of ["nbamodel", "nbaprops", "providerstatus"]) {
    assert.ok(edgeLab.rewrites.some((r) => r.source === `/api/${route}` &&
      r.destination === `/api/models?route=${route}`));
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await modelHandler({ method: "POST", query: { route } }, res);
    assert.equal(res.code, 405);
  }
  for (const route of [undefined, "toString", ["nbamodel"], "missing"]) {
    const res = { status(code) { this.code = code; return this; }, json() { return this; } };
    await modelHandler({ method: "GET", query: { route } }, res);
    assert.equal(res.code, 404);
  }
});

test("legacy root Vercel project has automatic deployments disabled", () => {
  assert.equal(root?.git?.deploymentEnabled, false);
});

test("Edge Lab Vercel project only auto-deploys master", () => {
  assert.deepEqual(edgeLab?.git?.deploymentEnabled, {
    master: true,
    "*": false
  });
});
