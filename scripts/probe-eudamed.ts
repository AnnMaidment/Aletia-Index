export {};
/**
 * scripts/probe-eudamed.ts
 *
 * EUDAMED Phase 2 — Step 0A endpoint characterisation probe.
 *
 * READ-ONLY. Makes NO writes (no DB, no EUDAMED mutation). Pure HTTP GETs
 * against the public EUDAMED API to resolve the two questions web_fetch
 * could not — page-size control + server-side filtering — plus a smoke
 * test of where the discriminating fields actually live.
 *
 * Run:  npx tsx scripts/probe-eudamed.ts
 *       (Node 18+ for global fetch.)
 *
 * This is the literal Step 0A deliverable: run it, paste the output back,
 * and we design the FDA-positive crosswalk (Phase B) against confirmed facts.
 */

const BASE = "https://ec.europa.eu/tools/eudamed/api/devices";
const LANG = "languageIso2Code=en&iso2Code=en";
const SLEEP_MS = 400; // be polite to a public EU endpoint

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

type PageMeta = {
  totalElements: number;
  returnedCount: number;
  pageSize: number;
  pageNumber: number;
  firstUuid?: string;
};

async function search(qs: string): Promise<PageMeta> {
  const j = await getJson(`${BASE}/udiDiData?${qs}`);
  return {
    totalElements: j.totalElements,
    returnedCount: j.numberOfElements ?? j.content?.length ?? 0,
    pageSize: j.size ?? j.pageable?.pageSize,
    pageNumber: j.number ?? j.pageable?.pageNumber,
    firstUuid: j.content?.[0]?.uuid,
  };
}

async function main() {
  console.log("=== EUDAMED Step 0A probe (READ-ONLY, no writes) ===\n");

  // ---- 1. Baseline ---------------------------------------------------------
  const base = await search(`page=0&${LANG}`);
  console.log("1. Baseline (no filter):");
  console.log(`   totalElements = ${base.totalElements.toLocaleString()}`);
  console.log(`   returned page size = ${base.pageSize}, count = ${base.returnedCount}\n`);
  await sleep(SLEEP_MS);

  // ---- 2. Page-size param detection (want max 300) -------------------------
  console.log("2. Page-size param detection (which param controls page size?):");
  const sizeTrials = [
    `page=0&size=100&${LANG}`,
    `page=0&pageSize=100&${LANG}`,
    `page=0&pageSize=100&size=100&${LANG}`,
    `page=0&pageSize=300&size=300&${LANG}`,
  ];
  for (const qs of sizeTrials) {
    const m = await search(qs);
    console.log(`   [${qs.replace(`&${LANG}`, "")}] -> returned size ${m.pageSize}, count ${m.returnedCount}`);
    await sleep(SLEEP_MS);
  }
  console.log("");

  // ---- 3. Pagination actually advances ------------------------------------
  console.log("3. Pagination check (page 0 vs page 2 first-uuid should differ):");
  const p0 = await search(`page=0&pageSize=300&size=300&${LANG}`);
  await sleep(SLEEP_MS);
  const p2 = await search(`page=2&pageSize=300&size=300&${LANG}`);
  console.log(`   page0 firstUuid = ${p0.firstUuid}`);
  console.log(`   page2 firstUuid = ${p2.firstUuid}`);
  console.log(`   -> pagination ${p0.firstUuid && p0.firstUuid !== p2.firstUuid ? "WORKS" : "did NOT advance"}\n`);
  await sleep(SLEEP_MS);

  // ---- 4. Server-side filter detection ------------------------------------
  // If a param is honoured, totalElements drops below baseline. If nothing
  // drops, the UI search uses a POST body or param names we haven't guessed —
  // in which case: open the official EUDAMED search UI, filter once, and copy
  // the exact request from the browser Network tab.
  console.log("4. Server-side filter detection (totalElements should DROP if honoured):");
  const filterTrials: Array<[string, string]> = [
    ["deviceName", "insulin"],
    ["tradeName", "insulin"],
    ["name", "insulin"],
    ["q", "insulin"],
    ["query", "insulin"],
    ["searchText", "insulin"],
    ["freeText", "insulin"],
    ["text", "insulin"],
    ["manufacturerName", "Medtronic"],
    ["deviceStatusCode", "refdata.device-model-status.on-the-market"],
    ["riskClassCode", "refdata.risk-class.class-iii"],
  ];
  const working: string[] = [];
  for (const [k, v] of filterTrials) {
    const m = await search(`page=0&${LANG}&${k}=${encodeURIComponent(v)}`);
    const dropped = m.totalElements < base.totalElements;
    console.log(`   ${k}=${v}  -> total ${m.totalElements.toLocaleString()} ${dropped ? "<- FILTERS" : "(ignored)"}`);
    if (dropped) working.push(k);
    await sleep(SLEEP_MS);
  }
  console.log(
    working.length
      ? `\n   => working server-side filter params: ${working.join(", ")}`
      : `\n   => NO tested param filtered. Grab the real request from the live UI Network tab\n      (ec.europa.eu/tools/eudamed/screen/search) — it may POST a filter body.`
  );
  console.log("");

  // ---- 5. Where do the discriminating fields live? ------------------------
  console.log("5. Detail / basic-UDI field smoke test:");
  if (base.firstUuid) {
    const detail = await getJson(`${BASE}/udiDiData/${base.firstUuid}?languageIso2Code=en`);
    const cnd = detail.cndNomenclatures?.map((c: any) => c.code) ?? [];
    console.log(`   device uuid ${base.firstUuid}`);
    console.log(`   cndNomenclatures (EMDN) codes : ${cnd.length ? cnd.join(", ") : "(none)"}`);
    console.log(`   additionalDescription         : ${detail.additionalDescription ? "present" : "empty/null"}`);
    console.log(`   udiPiType.softwareIdentification: ${detail.udiPiType?.softwareIdentification}`);
    await sleep(SLEEP_MS);

    const basicUdiUuid = detail.basicUdi?.uuid;
    if (basicUdiUuid) {
      const basic = await getJson(`${BASE}/basicUdiData/${basicUdiUuid}?languageIso2Code=en`);
      const certs = basic.deviceCertificateInfoList ?? [];
      console.log(`   basicUdiData.deviceName       : ${basic.deviceName ?? "(null)"}`);
      console.log(`   basicUdiData.specialDeviceType: ${basic.specialDeviceType?.code ?? "(none)"}`);
      console.log(`   medicalPurpose populated      : ${basic.medicalPurpose && Object.keys(basic.medicalPurpose).length ? "yes" : "no"}`);
      console.log(`   certificates                  : ${certs.length} (NB: ${certs[0]?.notifiedBody?.name ?? "n/a"})`);
    }
  }

  console.log("\n=== probe complete — no writes performed ===");
}

main().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
