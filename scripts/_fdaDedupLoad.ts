/**
 * scripts/_fdaDedupLoad.ts
 *
 * Shared data loading for the dedup scripts (detect + apply). Assembles
 * DeviceFacts (device row + its FDA submissions + product_codes/decision_dates
 * resolved from the FDA published list) and returns the raw external-id rows the
 * apply needs for the absorb plan. Not a script itself — imported.
 *
 * NB: product_code / decision_date are NOT persisted to device_master
 * (fdaSync writes name/manufacturer/tier/health only), so the FDA list join is
 * the only source of those clustering signals.
 */

import { createAdminClient } from '../lib/supabase-admin'
import { fetchFdaAiMlList, type FdaListEntry } from '../lib/fdaList'
import { FDA_ID_TYPES, type DeviceRow, type DeviceFacts, type ExternalIdRow } from '../lib/fdaDedup'

export interface DedupData {
  facts: DeviceFacts[]
  externalIdsByDevice: Map<string, ExternalIdRow[]>
}

export async function loadDedupFacts(): Promise<DedupData> {
  const admin = createAdminClient()

  // All non-excluded, non-merged device_master rows.
  const devices: DeviceRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('device_master')
      .select('aletia_id, name, manufacturer_name, manufacturer_link, created_at, data_source')
      .eq('excluded', false)
      .is('merged_into', null)
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) {
      // merged_into may not exist yet (pre-migration). Retry without it so the
      // detector still runs before the migration is applied.
      if (/merged_into/.test(error.message)) {
        return loadWithoutMergedInto(admin)
      }
      throw new Error(`device_master fetch failed: ${error.message}`)
    }
    devices.push(...((data ?? []) as DeviceRow[]))
    if (!data || data.length < 1000) break
  }

  return assemble(admin, devices)
}

async function loadWithoutMergedInto(
  admin: ReturnType<typeof createAdminClient>,
): Promise<DedupData> {
  const devices: DeviceRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('device_master')
      .select('aletia_id, name, manufacturer_name, manufacturer_link, created_at, data_source')
      .eq('excluded', false)
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`device_master fetch failed: ${error.message}`)
    devices.push(...((data ?? []) as DeviceRow[]))
    if (!data || data.length < 1000) break
  }
  return assemble(admin, devices)
}

async function assemble(
  admin: ReturnType<typeof createAdminClient>,
  devices: DeviceRow[],
): Promise<DedupData> {
  // All external-id rows (every type — the absorb moves non-FDA ids too).
  const allIds: ExternalIdRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('device_external_ids')
      .select('id, aletia_id, id_type, id_value')
      .range(from, from + 999)
    if (error) throw new Error(`external_ids fetch failed: ${error.message}`)
    allIds.push(...((data ?? []) as ExternalIdRow[]))
    if (!data || data.length < 1000) break
  }

  const externalIdsByDevice = new Map<string, ExternalIdRow[]>()
  const fdaSubsByDevice = new Map<string, string[]>()
  for (const r of allIds) {
    const arr = externalIdsByDevice.get(r.aletia_id) ?? []
    arr.push(r)
    externalIdsByDevice.set(r.aletia_id, arr)
    if ((FDA_ID_TYPES as readonly string[]).includes(r.id_type)) {
      const s = fdaSubsByDevice.get(r.aletia_id) ?? []
      s.push(r.id_value)
      fdaSubsByDevice.set(r.aletia_id, s)
    }
  }

  // FDA list → submission → {product_code, decision_date}.
  let list: FdaListEntry[] = []
  try {
    list = await fetchFdaAiMlList()
  } catch (e) {
    console.warn(`[warn] FDA list fetch failed (${(e as Error).message}); clustering will`
      + ' proceed WITHOUT product_code / decision_date signals.')
  }
  const listBySubmission = new Map<string, FdaListEntry>()
  for (const e of list) listBySubmission.set(e.identifier.trim().toUpperCase(), e)

  const facts: DeviceFacts[] = []
  for (const d of devices) {
    const subs = fdaSubsByDevice.get(d.aletia_id)
    if (!subs || subs.length === 0) continue // not FDA-origin — out of scope here

    const productCodes = new Set<string>()
    const dates: string[] = []
    for (const s of subs) {
      const entry = listBySubmission.get(s.trim().toUpperCase())
      if (entry?.product_code) productCodes.add(entry.product_code)
      if (entry?.decision_date) dates.push(entry.decision_date)
    }
    dates.sort()
    facts.push({ ...d, fdaIds: subs, productCodes: [...productCodes], earliestDecision: dates[0] ?? null })
  }

  return { facts, externalIdsByDevice }
}
