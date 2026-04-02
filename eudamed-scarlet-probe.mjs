/**
 * EUDAMED Scarlet NB Probe — with timeout
 * Run: node eudamed-scarlet-probe.mjs
 * Requires Node 18+
 */

const EUDAMED_BASE = 'https://ec.europa.eu/tools/eudamed/api';
const SCARLET_NB_NUMBER = '3022';
const TIMEOUT_MS = 30000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function main() {
  console.log('Querying EUDAMED for Scarlet NB (3022) — 30s timeout...\n');

  const url = new URL(`${EUDAMED_BASE}/devices/udiDiData`);
  url.searchParams.set('page',               '1');
  url.searchParams.set('pageSize',           '25');
  url.searchParams.set('size',               '25');
  url.searchParams.set('iso2Code',           'en');
  url.searchParams.set('languageIso2Code',   'en');
  url.searchParams.set('notifiedBodyNumber', SCARLET_NB_NUMBER);

  console.log('URL:', url.toString(), '\n');

  let res;
  try {
    res = await fetchWithTimeout(url.toString(), { headers: { 'Accept': 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('TIMED OUT after 30s. EUDAMED did not respond.');
    } else {
      console.error('Network error:', err.message);
    }
    process.exit(1);
  }

  if (!res.ok) {
    console.error('API error:', res.status, res.statusText);
    process.exit(1);
  }

  const data = await res.json();

  console.log('--- RESULTS ---');
  console.log('totalElements:', data.totalElements);
  console.log('totalPages   :', data.totalPages);
  console.log('returned     :', data.content?.length ?? 0);
  console.log('');

  if (!data.content?.length) {
    console.log('Zero devices returned for NB 3022.');
    console.log('Full response:', JSON.stringify(data, null, 2));
    return;
  }

  for (const d of data.content) {
    const cls  = d.riskClass?.code?.replace('refdata.risk-class.', '') ?? '?';
    const name = d.tradeName ?? d.deviceName ?? '(no name)';
    const mfr  = d.manufacturerName ?? '(no mfr)';
    console.log(`[${cls}] ${name} — ${mfr}`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
