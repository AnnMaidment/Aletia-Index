/**
 * scripts/probe-basicudi.ts  — READ-ONLY.
 * Settles two things our Step 0A probe left open:
 *   1. Which identifier actually resolves GET /devices/basicUdiData/{id}
 *      (our earlier probe guessed detail.basicUdi.uuid, which was falsy/wrong).
 *   2. Whether deviceCertificateInfoList / notified body is actually POPULATED.
 *
 * Run:                       npx tsx scripts/probe-basicudi.ts
 * Test a known AI device:    $env:UUID="<confirmed-match-uuid>"; npx tsx scripts/probe-basicudi.ts
 *   (grab a uuid from eudamed-crosswalk-results.json -> confirmed[].euUuid, a
 *    CE-marked AI device is the right thing to test cert population against.)
 */

const BASE = "https://ec.europa.eu/tools/eudamed/api/devices";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  // 1. What identifiers does a search row carry?
  const list = await getJson(`${BASE}/udiDiData?page=0&size=1&languageIso2Code=en&iso2Code=en`);
  const row = list.content?.[0] ?? {};
  console.log("=== search-row identifiers ===");
  for (const k of ["uuid", "basicUdi", "primaryDi", "ulid", "basicUdiDiDataUlid", "basicUdiDiDataUuid"])
    console.log(`  ${k}: ${JSON.stringify(row[k])}`);

  const uuid = process.env.UUID || row.uuid;
  console.log(`\n=== detail for ${uuid} ===`);
  const detail = await getJson(`${BASE}/udiDiData/${uuid}?languageIso2Code=en`);
  console.log("  top-level keys:", Object.keys(detail).join(", "));
  console.log("  detail.basicUdi =", JSON.stringify(detail.basicUdi));
  // surface anything that looks like a basic-UDI / ulid handle
  for (const k of Object.keys(detail))
    if (/basic|ulid/i.test(k)) console.log(`  ~ detail.${k} = ${JSON.stringify(detail[k])?.slice(0, 140)}`);

  await sleep(400);

  // 2. Try basicUdiData with every candidate identifier; report which resolves.
  const candidates: Record<string, any> = {
    "row.basicUdiDiDataUlid": row.basicUdiDiDataUlid,
    "row.basicUdi": row.basicUdi,
    "row.ulid": row.ulid,
    "detail.basicUdi?.uuid": detail.basicUdi?.uuid,
    "detail.basicUdi (string)": typeof detail.basicUdi === "string" ? detail.basicUdi : undefined,
  };

  console.log("\n=== basicUdiData resolution test ===");
  for (const [label, id] of Object.entries(candidates)) {
    if (!id) {
      console.log(`  ${label}: (no value to try)`);
      continue;
    }
    try {
      const b = await getJson(`${BASE}/basicUdiData/${id}?languageIso2Code=en`);
      const certs = b.deviceCertificateInfoList ?? [];
      console.log(`  ${label} = ${id}  -> RESOLVES`);
      console.log(`      deviceName: ${JSON.stringify(b.deviceName)}`);
      console.log(`      specialDeviceType: ${b.specialDeviceType?.code ?? "(none)"}`);
      console.log(`      certificates: ${certs.length}  NB: ${certs[0]?.notifiedBody?.name ?? "n/a"}  cert#: ${certs[0]?.certificateNumber ?? "n/a"}`);
    } catch (e: any) {
      console.log(`  ${label} = ${id}  -> ${e.message}`);
    }
    await sleep(400);
  }
  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error("probe failed:", e));
