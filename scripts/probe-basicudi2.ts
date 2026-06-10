/**
 * scripts/probe-basicudi2.ts — READ-ONLY.
 * Step 0A left the basic-UDI fetch unsolved: detail.basicUdi is undefined and
 * /basicUdiData/{id} 404s for every handle we have. This dumps the full raw
 * structures (so we stop guessing field names) and brute-tests route x id.
 *
 * Run: npx tsx scripts/probe-basicudi2.ts
 */

const DEV = "https://ec.europa.eu/tools/eudamed/api/devices";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchStatus(url: string): Promise<{ ok: boolean; status: number; json?: any }> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, json: await res.json() };
}

async function main() {
  const list = await fetchStatus(`${DEV}/udiDiData?page=0&size=1&languageIso2Code=en&iso2Code=en`);
  const row = list.json?.content?.[0] ?? {};
  console.log("=== FULL search row ===");
  console.log(JSON.stringify(row, null, 2));
  await sleep(400);

  const detail = (await fetchStatus(`${DEV}/udiDiData/${row.uuid}?languageIso2Code=en`)).json ?? {};
  console.log("\n=== detail.linkedUdiDiView ===");
  console.log(JSON.stringify(detail.linkedUdiDiView, null, 2));
  // any nested uuid we might use
  console.log("\n=== detail keys containing a uuid/id value ===");
  for (const k of Object.keys(detail)) {
    const v = detail[k];
    if (v && typeof v === "object" && (v.uuid || v.id || v.ulid))
      console.log(`  detail.${k}: ${JSON.stringify({ uuid: v.uuid, id: v.id, ulid: v.ulid })}`);
  }
  await sleep(400);

  // Brute-test: route segment x identifier.
  const routes = ["basicUdiData", "basicUdiDiData", "basicUdis", "basicUdi"];
  const ids: Record<string, any> = {
    ulid: row.ulid,
    basicUdiDiDataUlid: row.basicUdiDiDataUlid,
    basicUdi: row.basicUdi,
    primaryDi: row.primaryDi,
  };
  console.log("\n=== route x id matrix (GET /devices/{route}/{id}) ===");
  for (const route of routes) {
    for (const [label, id] of Object.entries(ids)) {
      if (!id) continue;
      const r = await fetchStatus(`${DEV}/${route}/${id}?languageIso2Code=en`);
      if (r.ok) {
        console.log(`  ${route}/${label}  -> ${r.status} OK   keys: ${Object.keys(r.json).slice(0, 12).join(", ")}`);
      } else {
        console.log(`  ${route}/${label}  -> ${r.status}`);
      }
      await sleep(300);
    }
  }

  // List form of each route — reveals the basic-UDI record's own id field.
  console.log("\n=== list form (GET /devices/{route}?page=0&size=1) ===");
  for (const route of routes) {
    const r = await fetchStatus(`${DEV}/${route}?page=0&size=1&languageIso2Code=en&iso2Code=en`);
    if (r.ok) {
      const first = r.json?.content?.[0];
      console.log(`  ${route} -> ${r.status} OK, total ${r.json?.totalElements}, row0 keys: ${first ? Object.keys(first).join(", ") : "(empty)"}`);
    } else {
      console.log(`  ${route} -> ${r.status}`);
    }
    await sleep(300);
  }
  console.log("\ndone — no writes performed");
}

main().catch((e) => console.error("probe failed:", e));
