export {};
/**
 * scripts/crosswalk-fda-eudamed.ts
 *
 * EUDAMED Phase 2 — Step 0A, the FDA-positive crosswalk.
 *
 * READ-ONLY. No DB writes, no EUDAMED mutation. Writes ONE local snapshot
 * file (eudamed-crosswalk-results.json) for inspection / reuse.
 *
 * Strategy (forced by the probe findings):
 *   - EUDAMED search filters on `tradeName` (free text), NOT manufacturer.
 *   - So: for each FDA AI/ML device, search EUDAMED by trade name / distinctive
 *     token, then confirm the manufacturer CLIENT-SIDE on the returned rows.
 *   - Tier each match Confirmed / Probable; everything else is Unmatched.
 *   - For Confirmed matches, fetch detail to harvest EMDN (cndNomenclatures)
 *     codes + description vocabulary — the bootstrap taxonomy for EU-only
 *     discovery later.
 *
 * Run a sample first:   npx tsx scripts/crosswalk-fda-eudamed.ts
 * Then the full run:     $env:MAX_FDA=0; npx tsx scripts/crosswalk-fda-eudamed.ts   (PowerShell)
 */

const BASE = "https://ec.europa.eu/tools/eudamed/api/devices";
const LANG = "languageIso2Code=en&iso2Code=en";
const SLEEP_MS = 400; // base delay between requests
const PAGE = 300; // confirmed max via `size`
const MAX_FDA = Number(process.env.MAX_FDA ?? 80); // 0 = all; default = quick sample
const MAX_RETRIES = 4; // retry 429 / 503 with exponential backoff
const BACKOFF_MS = 2000; // first backoff; doubles each retry
const MAX_QUERY_LEN = 80; // skip over-long tradeName queries (they 400 / are unspecific)

// Match thresholds — override via env without editing (e.g. $env:CONFIRM_NAME=0.92).
const T = {
  confirmName: Number(process.env.CONFIRM_NAME ?? 0.85), // Dice on trade name
  confirmMfr: Number(process.env.CONFIRM_MFR ?? 0.9), // Dice on normalised manufacturer
  probableName: Number(process.env.PROBABLE_NAME ?? 0.6),
  probableMfr: Number(process.env.PROBABLE_MFR ?? 0), // set 0.5 to drop cross-manufacturer name collisions
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- text utils -----------------------------------------------------------
const MFR_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|gmbh|co|corp|corporation|company|sa|srl|s\.r\.l|bv|b\.v|ag|plc|oy|ab|as|kg|kgaa|spa|s\.p\.a|pty|gk|kk|sas|sl)\b/gi;

function norm(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normMfr(s: string): string {
  return norm(s).replace(MFR_SUFFIXES, "").replace(/\s+/g, " ").trim();
}
function bigrams(s: string): Set<string> {
  const g = new Set<string>();
  const t = s.replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a),
    B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function distinctiveToken(name: string): string {
  return norm(name)
    .split(" ")
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)[0] || norm(name);
}

// ---- EUDAMED --------------------------------------------------------------
async function getJson(url: string, attempt = 0): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429 || res.status === 503) {
    if (attempt >= MAX_RETRIES) throw new Error(`${res.status} after ${attempt} retries`);
    const ra = Number(res.headers.get("retry-after"));
    const wait = (ra > 0 ? ra * 1000 : BACKOFF_MS * 2 ** attempt) + Math.random() * 300;
    await sleep(wait);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}
async function searchTradeName(q: string): Promise<any[]> {
  const url = `${BASE}/udiDiData?page=0&size=${PAGE}&${LANG}&tradeName=${encodeURIComponent(q)}`;
  const j = await getJson(url);
  return j.content ?? [];
}

// ---- FDA seed -------------------------------------------------------------
type FdaSeed = { name: string; manufacturer: string; submission: string; productCode: string };
async function loadFdaSeed(): Promise<FdaSeed[]> {
  // Field names verified against lib/fdaList.ts (FdaListEntry):
  //   device_name | applicant | identifier | product_code
  const { fetchFdaAiMlList } = await import("../lib/fdaList");
  const raw = await fetchFdaAiMlList();
  return raw
    .map((e) => ({
      name: e.device_name ?? "",
      manufacturer: e.applicant ?? "",
      submission: e.identifier ?? "",
      productCode: e.product_code ?? "",
    }))
    .filter((e) => e.name);
}

// ---- crosswalk ------------------------------------------------------------
type Match = {
  fda: FdaSeed;
  tier: "confirmed" | "probable";
  euUuid: string;
  euTradeName: string;
  euManufacturer: string;
  nameDice: number;
  mfrDice: number;
};

async function main() {
  console.log("=== FDA -> EUDAMED crosswalk (READ-ONLY) ===\n");
  const seed = await loadFdaSeed();
  const work = MAX_FDA > 0 ? seed.slice(0, MAX_FDA) : seed;
  console.log(`FDA seed: ${seed.length} devices; querying ${work.length}${MAX_FDA > 0 ? " (sample — set MAX_FDA=0 for all)" : ""}\n`);

  const confirmed: Match[] = [];
  const probable: Match[] = [];
  const unmatched: FdaSeed[] = [];
  const failed: { name: string; reason: string }[] = [];

  let i = 0;
  for (const fda of work) {
    i++;
    const full = norm(fda.name);
    const token = distinctiveToken(fda.name);
    // Over-long names (multi-model concatenations) 400 and are too unspecific —
    // fall back to the distinctive token only for those.
    const queries = Array.from(
      new Set(full.length <= MAX_QUERY_LEN ? [full, token] : [token])
    ).filter(Boolean);
    const rows: any[] = [];
    for (const q of queries) {
      try {
        rows.push(...(await searchTradeName(q)));
      } catch (e: any) {
        console.warn(`  ! search failed for "${q}": ${e.message}`);
        failed.push({ name: fda.name, reason: e.message });
      }
      await sleep(SLEEP_MS);
    }
    // dedupe by uuid
    const seen = new Set<string>();
    const cand = rows.filter((r) => r.uuid && !seen.has(r.uuid) && seen.add(r.uuid));

    let best: Match | null = null;
    for (const r of cand) {
      const nameDice = dice(norm(fda.name), norm(r.tradeName || ""));
      const mfrDice = dice(normMfr(fda.manufacturer), normMfr(r.manufacturerName || ""));
      const m: Match = {
        fda,
        tier: "probable",
        euUuid: r.uuid,
        euTradeName: r.tradeName || "",
        euManufacturer: r.manufacturerName || "",
        nameDice,
        mfrDice,
      };
      if (mfrDice >= T.confirmMfr && nameDice >= T.confirmName) m.tier = "confirmed";
      if (!best || m.nameDice + m.mfrDice > best.nameDice + best.mfrDice) best = m;
    }

    if (best && best.tier === "confirmed") confirmed.push(best);
    else if (best && best.nameDice >= T.probableName && best.mfrDice >= T.probableMfr)
      probable.push({ ...best, tier: "probable" });
    else unmatched.push(fda);

    if (i % 25 === 0) console.log(`  ...${i}/${work.length} (confirmed ${confirmed.length}, probable ${probable.length})`);
  }

  // Harvest EMDN + vocabulary from confirmed matches
  console.log("\nHarvesting EMDN codes + vocabulary from confirmed matches...");
  const emdn = new Map<string, number>();
  const words = new Map<string, number>();
  for (const m of confirmed) {
    try {
      const d = await getJson(`${BASE}/udiDiData/${m.euUuid}?languageIso2Code=en`);
      for (const c of d.cndNomenclatures ?? []) if (c.code) emdn.set(c.code, (emdn.get(c.code) || 0) + 1);
      for (const w of norm(`${m.euTradeName} ${d.additionalDescription ?? ""}`).split(" "))
        if (w.length >= 4) words.set(w, (words.get(w) || 0) + 1);
    } catch {
      /* skip */
    }
    await sleep(SLEEP_MS);
  }

  const topEmdn = [...emdn.entries()].sort((a, b) => b[1] - a[1]);
  const topWords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

  // ---- report ----
  console.log("\n========== CROSSWALK RESULT ==========");
  console.log(`FDA devices queried            : ${work.length}`);
  console.log(`EUDAMED counterparts confirmed : ${confirmed.length}`);
  console.log(`Probable matches (queue)       : ${probable.length}`);
  console.log(`Unmatched FDA devices          : ${unmatched.length}`);
  console.log(`Distinct EMDN codes (confirmed): ${topEmdn.length}`);
  console.log(`  ${topEmdn.slice(0, 15).map(([c, n]) => `${c}(${n})`).join(", ")}`);
  console.log(`Recurrent phrases (confirmed)  :`);
  console.log(`  ${topWords.map(([w, n]) => `${w}(${n})`).join(", ")}`);
  console.log("======================================");

  const fs = await import("fs");
  fs.writeFileSync(
    "eudamed-crosswalk-results.json",
    JSON.stringify(
      { generatedAt: new Date().toISOString(), thresholds: T, queried: work.length, confirmed, probable, unmatched, failed, topEmdn, topWords },
      null,
      2
    )
  );
  if (failed.length) console.log(`(${failed.length} searches still failed after retries — see "failed" in the JSON)`);
  console.log("\nSnapshot written: eudamed-crosswalk-results.json (no DB writes performed)");
}

main().catch((e) => {
  console.error("Crosswalk failed:", e);
  process.exit(1);
});
