/**
 * scripts/probe-scarlet-nb.ts — READ-ONLY.
 * Tests the two techniques the parked Scarlet route actually used, which our
 * earlier probes never tried:
 *   1. `notifiedBodyNumber` as a search filter on /devices/udiDiData
 *   2. /devices/basicUdiData/{DEVICE uuid}  (we'd only tried other identifiers)
 * NB 3022 = Scarlet, the software/AI-only notified body — every hit is AI by
 * definition, so this doubles as an alternative AI-isolation signal.
 *
 * Run: npx tsx scripts/probe-scarlet-nb.ts
 */

const DEV = "https://ec.europa.eu/tools/eudamed/api/devices";
const NB = process.env.NB || "3022"; // Scarlet
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Res = { status: number; kind: "json" | "html" | "error"; json?: any };
async function get(url: string): Promise<Res> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) return { status: res.status, kind: "error" };
  if (!ct.includes("json")) return { status: res.status, kind: "html" };
  try {
    return { status: res.status, kind: "json", json: await res.json() };
  } catch {
    return { status: res.status, kind: "html" };
  }
}

async function main() {
  // ---- 1. Does notifiedBodyNumber filter the search? ----
  const base = await get(`${DEV}/udiDiData?page=0&size=1&languageIso2Code=en&iso2Code=en`);
  const baseTotal = base.json?.totalElements ?? -1;
  console.log(`baseline total = ${baseTotal.toLocaleString()}`);
  await sleep(400);

  const nbRes = await get(`${DEV}/udiDiData?page=0&size=10&languageIso2Code=en&iso2Code=en&notifiedBodyNumber=${NB}`);
  const nbTotal = nbRes.json?.totalElements ?? -1;
  const filtered = nbRes.kind === "json" && nbTotal >= 0 && nbTotal < baseTotal;
  console.log(`notifiedBodyNumber=${NB} -> ${nbRes.status} ${nbRes.kind}, total ${nbTotal.toLocaleString()} ${filtered ? "<- FILTERS" : "(ignored or none)"}`);

  const sample: any[] = nbRes.json?.content ?? [];
  for (const d of sample.slice(0, 5)) console.log(`   • ${d.tradeName ?? "(no tradeName)"} | ${d.manufacturerName} | ${d.riskClass?.code} | uuid ${d.uuid}`);
  await sleep(400);

  // ---- 2. Does basicUdiData/{device.uuid} resolve with cert/NB? ----
  console.log(`\n=== basicUdiData/{device uuid} (the Scarlet detail call) ===`);
  const uuids = sample.slice(0, 3).map((d) => d.uuid);
  if (!uuids.length) {
    // fall back to a generic device if NB filter returned nothing
    const g = await get(`${DEV}/udiDiData?page=0&size=3&languageIso2Code=en&iso2Code=en`);
    uuids.push(...(g.json?.content ?? []).map((d: any) => d.uuid));
    await sleep(400);
  }
  for (const uuid of uuids) {
    const b = await get(`${DEV}/basicUdiData/${uuid}?languageIso2Code=en`);
    if (b.kind !== "json") {
      console.log(`  ${uuid} -> ${b.status} ${b.kind}`);
    } else {
      const certs = b.json.deviceCertificateInfoList ?? [];
      console.log(`  ${uuid} -> RESOLVES`);
      console.log(`      deviceName : ${JSON.stringify(b.json.deviceName)}`);
      console.log(`      legislation: ${b.json.legislation?.code ?? "(none)"}`);
      console.log(`      certificates: ${certs.length}  NB: ${certs[0]?.notifiedBody?.name ?? "n/a"} (${certs[0]?.notifiedBody?.srn ?? "?"})  cert# ${certs[0]?.certificateNumber ?? "n/a"}`);
    }
    await sleep(400);
  }
  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error("probe failed:", e));
