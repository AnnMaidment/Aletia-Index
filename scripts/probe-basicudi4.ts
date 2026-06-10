/**
 * scripts/probe-basicudi4.ts — READ-ONLY. The last untested avenue.
 * The /basicUdiData/{uuid} lookup is dead (the link field is null everywhere).
 * This tests the LIST/SEARCH form — GET /devices/basicUdiData?... — and whether
 * it's filterable by the `basicUdi` string the device rows DO carry. If that
 * resolves a basic-UDI record (with cert/NB), there's a path after all. If not,
 * NB/cert is genuinely not exposed yet and the enrichment is correctly deferred.
 *
 * Run: npx tsx scripts/probe-basicudi4.ts
 */

const DEV = "https://ec.europa.eu/tools/eudamed/api/devices";
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

function reportBasic(tag: string, j: any) {
  const first = j?.content?.[0];
  console.log(`  ${tag}: total ${j?.totalElements}, ${j?.content?.length ?? 0} rows`);
  if (first) {
    console.log(`    row0 keys: ${Object.keys(first).join(", ")}`);
    const certs = first.deviceCertificateInfoList ?? [];
    console.log(`    row0 deviceName: ${JSON.stringify(first.deviceName)}`);
    console.log(`    row0 specialDeviceType: ${first.specialDeviceType?.code ?? "(none)"}`);
    console.log(`    row0 certificates: ${certs.length}  NB: ${certs[0]?.notifiedBody?.name ?? "n/a"}`);
  }
}

async function main() {
  // Grab a basicUdi string from a real device.
  const target = process.env.TRADENAME || "Swoop";
  const dev = await get(`${DEV}/udiDiData?page=0&size=1&languageIso2Code=en&iso2Code=en&tradeName=${encodeURIComponent(target)}`);
  const row = dev.json?.content?.[0] ?? {};
  const basicUdi = row.basicUdi;
  console.log(`device "${row.tradeName}" basicUdi = ${basicUdi}\n`);
  await sleep(400);

  console.log("=== basic-UDI list/search attempts ===");

  // 1. plain list
  const a = await get(`${DEV}/basicUdiData?page=0&size=1&languageIso2Code=en&iso2Code=en`);
  console.log(`/basicUdiData (no filter) -> ${a.status} ${a.kind}`);
  if (a.kind === "json") reportBasic("no-filter", a.json);
  await sleep(400);

  // 2. filtered by the basicUdi string (candidate param names)
  for (const p of ["basicUdi", "basicUdiDi", "code", "basicUdiCode"]) {
    const u = `${DEV}/basicUdiData?page=0&size=1&languageIso2Code=en&iso2Code=en&${p}=${encodeURIComponent(basicUdi)}`;
    const r = await get(u);
    console.log(`/basicUdiData?${p}=… -> ${r.status} ${r.kind}` + (r.kind === "json" ? ` (total ${r.json?.totalElements})` : ""));
    if (r.kind === "json" && r.json?.totalElements && r.json.totalElements < (a.json?.totalElements ?? Infinity)) reportBasic(`filtered:${p}`, r.json);
    await sleep(300);
  }

  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error("probe failed:", e));
