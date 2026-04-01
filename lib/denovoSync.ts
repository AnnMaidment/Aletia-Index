/**
 * lib/denovoSync.ts
 * Syncs FDA De Novo devices into device_master + regional_registrations.
 * Follows the same pattern as fdaSync.ts.
 *
 * De Novo numbers: DEN######  e.g. DEN190040, DEN220063
 * openFDA endpoint: GET /device/denovo.json?search=de_novo_number:DEN######
 */

import { supabase } from './supabase'
import { getAdverseEventCount, getClassificationByProductCode } from './fda'
import type { SyncResult } from './fdaSync'

const FDA_API_BASE = 'https://api.fda.gov'

// ── openFDA De Novo response shape (partial) ─────────────────────────────────
interface DeNovoResult {
  de_novo_number: string
  device_name: string
  applicant: string
  decision_date: string
  decision: string           // 'Granted' etc
  product_code: string
  regulation_number?: string
  type?: string
}

interface DeNovoResponse {
  results: DeNovoResult[]
  meta?: { results?: { total: number } }
}

// ── Fetch a single De Novo by number ────────────────────────────────────────

async function getDeNovoByNumber(deNovoNumber: string): Promise<DeNovoResult | null> {
  const apiKey = process.env.OPENFDA_API_KEY
  const keyParam = apiKey ? `&api_key=${apiKey}` : ''

  const url = `${FDA_API_BASE}/device/denovo.json?search=de_novo_number:${deNovoNumber}&limit=1${keyParam}`

  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      console.warn(`[denovoSync] openFDA returned ${response.status} for ${deNovoNumber}`)
      return null
    }
    const data: DeNovoResponse = await response.json()
    return data.results?.[0] ?? null
  } catch (err) {
    console.error(`[denovoSync] fetch failed for ${deNovoNumber}:`, err)
    return null
  }
}

// ── Derive health status ─────────────────────────────────────────────────────

function deriveHealthStatus(adverseEventCount: number): 'Green' | 'Amber' | 'Red' {
  if (adverseEventCount > 50) return 'Amber'
  return 'Green'
  // De Novo devices don't have recalls in the same way as 510(k)s
  // Red status can be set manually if needed
}

// ── Main sync function ───────────────────────────────────────────────────────

export async function syncDeNovoDevice(deNovoNumber: string): Promise<SyncResult> {
  const updatedFields: string[] = []

  try {
    // 1. Fetch De Novo data from openFDA
    const clearanceData = await getDeNovoByNumber(deNovoNumber)

    if (!clearanceData) {
      return {
        device_id: deNovoNumber,
        success: false,
        updated_fields: [],
        recall_alert: false,
        error: `No De Novo record found for ${deNovoNumber} in openFDA`,
      }
    }

    // 2. Check classification — reject Class I
    const classification = clearanceData.product_code
      ? await getClassificationByProductCode(clearanceData.product_code)
      : null

    if (clearanceData.product_code && !classification) {
      return {
        device_id: deNovoNumber,
        success: false,
        updated_fields: [],
        recall_alert: false,
        error: 'Device is Class I — out of scope for Aletia Index',
      }
    }

    // 3. Fetch adverse events
    const { total_events } = await getAdverseEventCount(clearanceData.device_name ?? deNovoNumber)

    // 4. Derive health status
    const health_status = deriveHealthStatus(total_events)

    // 5. Upsert DEVICE_MASTER
    const deviceUpsert: Record<string, unknown> = {
      device_id: deNovoNumber,
      health_status,
      last_automated_sync: new Date().toISOString(),
      data_source: 'registry_sync',
      excluded: false,
      country_of_origin: 'US',
    }

    if (clearanceData.applicant) {
      deviceUpsert.manufacturer_name = clearanceData.applicant
      updatedFields.push('manufacturer_name')
    }

    if (clearanceData.device_name) {
      deviceUpsert.intended_use = clearanceData.device_name
      updatedFields.push('intended_use')
    }

    if (classification?.device_class) {
      const tierMap: Record<string, number> = { '2': 2, '3': 4 }
      deviceUpsert.accountability_tier = tierMap[classification.device_class] ?? 2
      updatedFields.push('accountability_tier')
    }

    updatedFields.push('health_status', 'last_automated_sync')

    const { error: deviceError } = await supabase
      .from('device_master')
      .upsert(deviceUpsert, { onConflict: 'device_id' })

    if (deviceError) {
      throw new Error(`device_master upsert failed: ${deviceError.message}`)
    }

    // 6. Upsert REGIONAL_REGISTRATIONS
    const regRecord = {
      device_link: deNovoNumber,
      country: 'US',
      regulatory_body: 'FDA',
      clearance_type: 'De Novo',
    }

    const { error: regError } = await supabase
      .from('regional_registrations')
      .upsert(regRecord, {
        onConflict: 'device_link,country,regulatory_body',
      })

    if (regError) {
      console.warn(`[denovoSync] regional_registrations upsert warning: ${regError.message}`)
    } else {
      updatedFields.push('regional_registrations')
    }

    return {
      device_id: deNovoNumber,
      success: true,
      updated_fields: updatedFields,
      recall_alert: false,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[denovoSync] syncDeNovoDevice failed for ${deNovoNumber}:`, message)
    return {
      device_id: deNovoNumber,
      success: false,
      updated_fields: [],
      recall_alert: false,
      error: message,
    }
  }
}
