import { fetchEudamedAiMlDevices } from "../lib/eudamed"

fetchEudamedAiMlDevices({ codes: ["Z11069092"], delayMs: 400, limitPerCode: 5 })
  .then((rows) => { console.log("count:", rows.length); console.dir(rows.slice(0, 3), { depth: null }) })
  .catch((e) => { console.error(e); process.exit(1) })