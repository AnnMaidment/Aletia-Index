import { readFileSync } from "fs"
const j = JSON.parse(readFileSync("eudamed-crosswalk-results.json", "utf8"))
const all = [...(j.confirmed ?? []), ...(j.probable ?? [])]
const byUuid = new Map<string, Set<string>>()
for (const e of all) {
  const u = e.euUuid, s = e.fda?.submission
  if (!u || !s) continue
  if (!byUuid.has(u)) byUuid.set(u, new Set())
  byUuid.get(u)!.add(s)
}
const multi = [...byUuid.entries()].filter(([, subs]) => subs.size > 1)
console.log("distinct euUuids:", byUuid.size)
console.log("euUuids with >1 distinct FDA submission:", multi.length)
console.log("sample:", multi.slice(0, 5).map(([u, s]) => ({ euUuid: u, submissions: [...s] })))
