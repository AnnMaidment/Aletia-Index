export {};
/**
 * scripts/probe-emdn-filter.ts  — READ-ONLY.
 * Tests whether EMDN/CND nomenclature is a server-side search filter.
 * Run (separate terminal is fine, even while the crosswalk runs):
 *   npx tsx scripts/probe-emdn-filter.ts
 *
 * Interpreting each row:
 *   total UNCHANGED (2,416,171) -> param ignored
 *   total dropped & > 0         -> WORKS (this param + value format filters)
 *   total = 0                   -> param likely valid but value FORMAT is wrong
 *                                  (try a prefix, or full vs partial code)
 */

const BASE = "https://ec.europa.eu/tools/eudamed/api/devices/udiDiData";
const LANG = "languageIso2Code=en&iso2Code=en";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function total(qs: string): Promise<number> {
  const res = await fetch(`${BASE}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return -1;
  const j = await res.json();
  return j.totalElements ?? -1;
}

async function main() {
  const base = await total(`page=0&size=1&${LANG}`);
  console.log(`baseline total = ${base.toLocaleString()}\n`);
  await sleep(300);

  // Candidate param names x candidate value formats.
  const params = [
    "cndCode", "cndCodes", "cnd", "cndNomenclature", "cndNomenclatureCode",
    "nomenclatureCode", "nomenclature", "emdnCode", "emdn", "code",
  ];
  const values = [
    ["exact", "Z11040104"], // a code with known hits in the crosswalk
    ["prefix", "Z11"],      // does it accept a family prefix?
    ["vcode", "V92"],
  ] as const;

  for (const p of params) {
    for (const [label, v] of values) {
      const t = await total(`page=0&size=1&${LANG}&${p}=${encodeURIComponent(v)}`);
      const verdict =
        t === base ? "ignored" : t === 0 ? "= 0 (param ok? value format off)" : `<- FILTERS (${t.toLocaleString()})`;
      console.log(`${p}=${v} [${label}]  -> ${verdict}`);
      await sleep(250);
    }
  }
  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error(e));
