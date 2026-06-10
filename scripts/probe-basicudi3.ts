/**
 * scripts/probe-basicudi3.ts — READ-ONLY.
 * Finding: the basic-UDI record is keyed off `basicUdiDataUuid` (NOT
 * basicUdiDiDataUlid), and it was null on the random Class-A device we tested.
 * This targets a properly-registered AI device (where it should be populated),
 * resolves /basicUdiData/{uuid}, checks cert/NB, and measures how often the
 * link is populated across the population. Hardened against HTML responses.
 *
 * Run:                       npx tsx scripts/probe-basicudi3.ts
 * Different AI device:        $env:TRADENAME="BriefCase"; npx tsx scripts/probe-basicudi3.ts
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

async function tryBasicUdi(label: string, id: any) {
  if (!id) return console.log(`  basicUdiData via ${label}: (null — nothing to try)`);
  const b = await get(`${DEV}/basicUdiData/${id}?languageIso2Code=en`);
  if (b.kind !== "json") return console.log(`  basicUdiData via ${label} (${id}) -> ${b.status} ${b.kind}`);
  const certs = b.json.deviceCertificateInfoList ?? [];
  console.log(`  basicUdiData via ${label} (${id}) -> RESOLVES`);
  console.log(`      deviceName       : ${JSON.stringify(b.json.deviceName)}`);
  console.log(`      specialDeviceType: ${b.json.specialDeviceType?.code ?? "(none)"}`);
  console.log(`      applicableLegisl.: ${b.json.applicableLegislation?.code ?? b.json.legislation ?? "(none)"}`);
  console.log(`      certificates     : ${certs.length}  NB: ${certs[0]?.notifiedBody?.name ?? "n/a"}  cert#: ${certs[0]?.certificateNumber ?? "n/a"}`);
}

async function main() {
  const target = process.env.TRADENAME || "Swoop";
  console.log(`=== searching tradeName="${target}" ===`);
  const r = await get(`${DEV}/udiDiData?page=0&size=50&languageIso2Code=en&iso2Code=en&tradeName=${encodeURIComponent(target)}`);
  const rows: any[] = r.json?.content ?? [];
  const withLink = rows.filter((x) => x.basicUdiDataUuid);
  console.log(`got ${rows.length} rows; ${withLink.length} have a non-null basicUdiDataUuid`);

  const pick = withLink[0] ?? rows[0];
  if (!pick) {
    console.log("no rows — try a different TRADENAME");
    return;
  }
  console.log(`\npicked: "${pick.tradeName}" | ${pick.manufacturerName} | risk ${pick.riskClass?.code}`);
  console.log(`  basicUdiDataUuid   : ${pick.basicUdiDataUuid}`);
  console.log(`  basicUdiDataUlid   : ${pick.basicUdiDataUlid}`);
  console.log(`  basicUdiDiDataUlid : ${pick.basicUdiDiDataUlid}`);
  await sleep(400);

  console.log("\n=== resolution test ===");
  await tryBasicUdi("basicUdiDataUuid", pick.basicUdiDataUuid);
  await sleep(400);
  await tryBasicUdi("basicUdiDataUlid", pick.basicUdiDataUlid);

  // How common is the basic-UDI link in the general population?
  await sleep(400);
  const g = await get(`${DEV}/udiDiData?page=0&size=100&languageIso2Code=en&iso2Code=en`);
  const grows: any[] = g.json?.content ?? [];
  const gWith = grows.filter((x) => x.basicUdiDataUuid).length;
  console.log(`\ngeneric population: ${gWith}/${grows.length} rows have a non-null basicUdiDataUuid`);
  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error("probe failed:", e));
