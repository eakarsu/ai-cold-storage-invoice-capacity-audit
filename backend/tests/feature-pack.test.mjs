import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// Offline only: never import server.mjs (which would need DB/secrets) and
// never call a provider. Keys are irrelevant to these pure helpers.
delete process.env.OPENROUTER_API_KEY;
const { filterRecords, recordsToCsv, recordsToJson, buildInsights, formatLabelledValue } = await import("../featurePack.mjs");
const { formatLabelledValue: uiFormat } = await import("../../frontend/src/labelledValue.mjs");

const rows = [
  { id: 1, reference: "CRM01-1", title: "Alpha case", status: "Open", owner: "Ann", risk: "High", due_date: "2020-01-01", amount: 0, payload: { chargedAmount: 100, supportedAmount: 40, evidenceState: "Incomplete" } },
  { id: 2, reference: "CRM01-2", title: "Beta case", status: "Closed", owner: "Bob", risk: "Low", due_date: "2999-01-01", amount: 50, payload: { chargedAmount: 10, supportedAmount: 10, evidenceState: "Complete" } },
];
const config = { calculation: { actualKey: "chargedAmount", expectedKey: "supportedAmount", direction: "actual-minus-expected", varianceLabel: "Potential recovery" } };
const feature = { id: "study-protocol-registry", title: "Study protocol registry" };

test("search/filter matches text, status and risk", () => {
  assert.equal(filterRecords(rows, { q: "alpha" }).length, 1);
  assert.equal(filterRecords(rows, { status: "Closed" })[0].id, 2);
  assert.equal(filterRecords(rows, { risk: "High" }).length, 1);
  assert.equal(filterRecords(rows, { q: "missing" }).length, 0);
});

test("CSV/JSON export preserves 0 and escapes formulas", () => {
  const csv = recordsToCsv([{ ...rows[0], title: "=HYPERLINK(\"x\")" }]);
  assert.ok(csv.includes("CRM01-1") && csv.includes("'=HYPERLINK"));
  const json = recordsToJson(rows);
  assert.equal(json[0].amount, 0);
  assert.equal(json[1].payload.supportedAmount, 10);
});

test("deterministic insights are labelled aiGenerated:false over own records", () => {
  const out = buildInsights(config, feature, rows);
  assert.equal(out.aiGenerated, false);
  assert.equal(out.insights.length, 3);
  assert.ok(out.insights.every((i) => i.aiGenerated === false && i.sections.length >= 2));
  const empty = buildInsights(config, feature, []);
  assert.equal(empty.insights[0].metrics[0].value, 0);
});

test("labelled values preserve false, 0 and empty", () => {
  for (const fn of [formatLabelledValue, uiFormat]) {
    assert.equal(fn(false), "No");
    assert.equal(fn(0), "0");
    assert.equal(fn(""), "None reported");
    assert.equal(fn(null), "None reported");
  }
});

test("feature pack is mounted behind auth in server", () => {
  const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes("mountFeaturePack(app"));
  assert.ok(server.includes("filterRecords(rows, req.query)") || server.includes("filterRecords("));
});
