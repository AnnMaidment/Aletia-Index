export {};
const BASE = "https://ec.europa.eu/tools/eudamed/api/devices"

async function getJson(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(res.status + " for " + url)
  return res.json()
}

async function main() {
  const detail = await getJson(BASE + "/udiDiData/b3876ed6-5068-4af2-9884-b2af6dd5597a?languageIso2Code=en")
  console.log("--- full detail response ---")
  console.dir(detail, { depth: 4 })
}
main().catch(e => { console.error(e); process.exit(1) })
