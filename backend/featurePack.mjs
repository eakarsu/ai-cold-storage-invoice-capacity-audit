// Feature pack: search/filter, CSV/JSON export, and deterministic
// domain insights over this app's own feature_records.
// No provider calls are made here; insights are an offline fallback
// and are always labelled aiGenerated:false.

export function formatLabelledValue(value) {
  if (value === false) return "No";
  if (value === true) return "Yes";
  if (value === 0) return "0";
  if (value === "" || value === null || value === undefined) return "None reported";
  return String(value);
}

function rowText(row) {
  const payload = row?.payload && typeof row.payload === "object" ? Object.values(row.payload).join(" ") : "";
  return [row?.reference, row?.title, row?.status, row?.owner, row?.risk, payload].filter((v) => v != null).join(" ").toLowerCase();
}

export function filterRecords(rows, query = {}) {
  const q = String(query.q || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const risk = String(query.risk || "").trim();
  return (rows || []).filter((row) => {
    if (status && row.status !== status) return false;
    if (risk && row.risk !== risk) return false;
    if (q && !rowText(row).includes(q)) return false;
    return true;
  });
}

function csvCell(value) {
  let s = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+@\t\r-]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const EXPORT_COLUMNS = ["id", "reference", "title", "status", "owner", "risk", "due_date", "amount"];

export function recordsToCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of rows || []) lines.push(EXPORT_COLUMNS.map((c) => csvCell(row?.[c])).join(","));
  return lines.join("\n");
}

export function recordsToJson(rows) {
  return (rows || []).map((row) => ({
    id: row?.id ?? null,
    reference: row?.reference ?? "",
    title: row?.title ?? "",
    status: row?.status ?? "",
    owner: row?.owner ?? "",
    risk: row?.risk ?? "",
    due_date: row?.due_date ?? null,
    amount: row?.amount == null ? 0 : Number(row.amount),
    payload: row?.payload ?? {},
  }));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function buildInsights(config, feature, rows) {
  const records = rows || [];
  const rule = config?.calculation || {};
  const actualKey = rule.actualKey, expectedKey = rule.expectedKey;
  let totalVariance = 0, withVariance = 0, largest = 0;
  for (const row of records) {
    const p = row?.payload || {};
    const actual = num(p[actualKey]) || num(row?.amount);
    const expected = num(p[expectedKey]);
    const variance = rule.direction === "expected-minus-actual" ? Math.max(0, expected - actual) : Math.max(0, actual - expected);
    totalVariance += variance; if (variance > 0) withVariance += 1; if (variance > largest) largest = variance;
  }
  const attention = records.filter((r) => !["Approved", "Closed"].includes(r.status)).length;
  const highRisk = records.filter((r) => ["High", "Critical"].includes(r.risk)).length;
  const incomplete = records.filter((r) => {
    const state = r?.payload?.evidenceState ?? r?.payload?.evidence_state;
    return state != null && state !== "" ? state !== "Complete" : !["Approved", "Closed"].includes(r.status);
  }).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = records.filter((r) => r?.due_date && String(r.due_date).slice(0, 10) < today && !["Approved", "Closed"].includes(r.status)).length;
  const base = { aiGenerated: false, source: "deterministic-fallback" };
  const insight = (id, title, metrics, detail) => ({
    ...base, id, title,
    label: "Deterministic fallback — not AI-generated",
    metrics,
    sections: [
      { title: "Finding (deterministic)", detail },
      { title: "Basis", detail: `Computed locally from ${records.length} saved ${feature.title} record(s). No provider call was made; validate source evidence before acting.` },
    ],
  });
  return {
    ...base,
    provider: "Deterministic fallback (offline)",
    featureId: feature.id,
    insights: [
      insight("variance-exposure", `${rule.varianceLabel || "Variance"} exposure`,
        [{ label: "Records reviewed", value: records.length }, { label: `Total ${rule.varianceLabel || "variance"}`, value: Math.round(totalVariance * 100) / 100 }, { label: "Records with variance", value: withVariance }, { label: "Largest single variance", value: Math.round(largest * 100) / 100 }],
        records.length ? `${withVariance} of ${records.length} record(s) show a positive ${rule.varianceLabel || "variance"}; total ${Math.round(totalVariance * 100) / 100}.` : "No saved records yet; variance is 0."),
      insight("evidence-completeness", "Evidence and workflow completeness",
        [{ label: "Records reviewed", value: records.length }, { label: "Incomplete evidence", value: incomplete }, { label: "Overdue open records", value: overdue }, { label: "Any overdue record", value: overdue > 0 }],
        `${incomplete} record(s) lack complete evidence and ${overdue} open record(s) are past due.`),
      insight("risk-attention", "Risk and attention queue",
        [{ label: "Records requiring attention", value: attention }, { label: "High or critical risk", value: highRisk }, { label: "Any high-risk record", value: highRisk > 0 }, { label: "Closed or approved", value: records.length - attention }],
        `${attention} record(s) still require attention; ${highRisk} are high or critical risk.`),
    ],
  };
}

export function mountFeaturePack(app, { pool, auth, featureById, config }) {
  if (typeof auth !== "function") throw new Error("mountFeaturePack requires the auth middleware");
  app.get("/api/features/:id/records/export", auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const format = String(req.query.format || "json").toLowerCase();
      if (!["csv", "json"].includes(format)) return res.status(422).json({ error: "Choose CSV or JSON" });
      const rows = filterRecords((await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC", [feature.id])).rows, req.query);
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${feature.id}-records.csv"`);
        return res.send(recordsToCsv(rows));
      }
      res.setHeader("Content-Disposition", `attachment; filename="${feature.id}-records.json"`);
      return res.json({ items: recordsToJson(rows) });
    } catch (error) { next(error); }
  });
  app.get("/api/features/:id/insights", auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const rows = (await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC", [feature.id])).rows;
      return res.json(buildInsights(config, feature, rows));
    } catch (error) { next(error); }
  });
}
