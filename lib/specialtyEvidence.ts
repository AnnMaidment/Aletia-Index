/**
 * lib/specialtyEvidence.ts
 *
 * Source-shape normalisation for specialty inference.
 *
 * This is the ONLY place that knows where each ingestion source keeps its
 * device name, title, clinical text, panel, etc. It flattens a heterogeneous
 * raw_data record — CT.gov (camelCase), O'Leary CSV (snake_case), eudamed_sync,
 * fda_sync — into a single normalised SpecialtyEvidence bundle.
 *
 * lib/specialtyTaxonomy.ts then answers the orthogonal question — "what does
 * this evidence indicate?" — without ever touching source field names. Keeping
 * the two layers separate is deliberate (and was the point of this refactor):
 *   - the taxonomy must not accumulate per-source shape logic, and
 *   - the evidence builder must not accumulate clinical knowledge.
 *
 * The bundle deliberately carries MORE than the deterministic matcher uses
 * today (panel, productCode, emdnDescription, riskClass). Those are kept for
 * provenance and for the later enrichment phase (LLM / cluster specialty
 * agreement). The deterministic matcher in specialtyTaxonomy.ts intentionally
 * keys off the CLINICAL text fields only and ignores panel/productCode — a raw
 * FDA panel like "Radiology" is a regulatory review lane, not a clinical
 * specialty signal, and leaning on it reintroduces the construct-validity
 * problem we rejected for the device_master backfill.
 *
 * Used by:
 *   - lib/extractQueueSpecialty.ts (backfill the review queue)
 *   - lib/specialtyTaxonomy.ts     (consumes the bundle)
 *   - future: dedup cluster specialty-agreement signal, LLM enrichment evidence
 */

export interface SpecialtyEvidence {
  deviceName: string;
  manufacturerName: string;
  title: string;
  descriptionText: string;
  intendedUseText: string;
  conditionsText: string;
  summaryText: string;
  panel: string;
  productCode: string;
  emdnDescription: string;
  riskClass: string;
  /** raw_data key paths that actually contributed a non-empty value. Provenance. */
  sourceFieldsUsed: string[];
}

/**
 * Build a normalised evidence bundle from a single raw_data record.
 *
 * `source` is accepted for future source-specific handling but is not required;
 * the alias lists below already cover every source's shape, so the builder is
 * source-agnostic in practice. It is passed through so callers don't have to
 * special-case, and so future per-source rules have a hook.
 */
export function buildSpecialtyEvidence(rawData: any, _source?: string): SpecialtyEvidence {
  if (!rawData || typeof rawData !== 'object') {
    return emptyEvidence();
  }

  const used: string[] = [];

  // Device name — single best value (first non-empty alias wins).
  const deviceName = pick(rawData, [
    'device_name',
    'deviceName',
    'device',
    'interventionName',
    'name',
  ], used);

  // Title — single best value.
  const title = pick(rawData, [
    'brief_title',
    'briefTitle',
    'title',
    'protocolSection.identificationModule.briefTitle',
    'protocolSection.identificationModule.officialTitle',
  ], used);

  // Summary — single best value, truncated.
  const summaryText = truncate(pick(rawData, [
    'brief_summary',
    'briefSummary',
    'protocolSection.descriptionModule.briefSummary',
    'summary',
  ], used), 2000);

  // Description — single best value, truncated.
  const descriptionText = truncate(pick(rawData, [
    'description',
    'additionalDescription',
    'protocolSection.descriptionModule.detailedDescription',
  ], used), 2000);

  // Intended use / medical purpose — single best value.
  const intendedUseText = pick(rawData, [
    'intended_use',
    'intendedUse',
    'medical_purpose',
    'intended_purpose',
    'intendedPurpose',
  ], used);

  // Clinical terms — AGGREGATE all available (conditions + mesh + keywords),
  // because a pattern may live in keywords even when conditions don't carry it.
  // These are all clinical-vocabulary fields, safe to concatenate.
  const conditionsText = gather(rawData, [
    'conditions',
    'condition',
    'protocolSection.conditionsModule.conditions',
    'mesh_terms',
    'meshTerms',
    'derivedSection.conditionBrowseModule.meshes',
    'derivedSection.interventionBrowseModule.meshes',
    'keywords',
    'protocolSection.conditionsModule.keywords',
  ], used);

  // Manufacturer / sponsor — single best value (not used by the matcher today,
  // carried for provenance and enrichment).
  const manufacturerName = pick(rawData, [
    'manufacturer_name',
    'sponsorName',
    'sponsor',
    'applicant',
    'manufacturer',
  ], used);

  // Regulatory fields — CARRIED but NOT fed to the deterministic matcher.
  const panel = pick(rawData, [
    'panel',
    'advisory_committee_description',
    'advisory_committee',
  ], used);
  const productCode = pick(rawData, ['product_code', 'product_codes'], used);
  const emdnDescription = pick(rawData, [
    'emdn_description',
    'emdnDescription',
    'cndCode',
    'cnd_code',
  ], used);
  const riskClass = pick(rawData, ['risk_class', 'riskClass'], used);

  return {
    deviceName,
    manufacturerName,
    title,
    descriptionText,
    intendedUseText,
    conditionsText,
    summaryText,
    panel,
    productCode,
    emdnDescription,
    riskClass,
    sourceFieldsUsed: Array.from(new Set(used)),
  };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function emptyEvidence(): SpecialtyEvidence {
  return {
    deviceName: '',
    manufacturerName: '',
    title: '',
    descriptionText: '',
    intendedUseText: '',
    conditionsText: '',
    summaryText: '',
    panel: '',
    productCode: '',
    emdnDescription: '',
    riskClass: '',
    sourceFieldsUsed: [],
  };
}

/** First non-empty alias wins. Records the contributing key path. */
function pick(raw: any, paths: string[], used: string[]): string {
  for (const path of paths) {
    const value = resolve(raw, path);
    const s = coerce(value).trim();
    if (s) {
      used.push(path);
      return s;
    }
  }
  return '';
}

/** Concatenate every non-empty alias. Records each contributing key path. */
function gather(raw: any, paths: string[], used: string[]): string {
  const parts: string[] = [];
  for (const path of paths) {
    const value = resolve(raw, path);
    const s = coerce(value).trim();
    if (s) {
      parts.push(s);
      used.push(path);
    }
  }
  return parts.join(' | ');
}

/** Walk a dot-path (e.g. 'protocolSection.conditionsModule.conditions'). */
function resolve(raw: any, path: string): any {
  if (!path.includes('.')) return raw?.[path];
  let cur = raw;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Coerce strings / numbers / arrays / mesh-term objects into matchable text. */
function coerce(value: any): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map(coerceScalar).filter(Boolean).join(' | ');
  }
  return coerceScalar(value);
}

function coerceScalar(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    // CT.gov mesh entries look like { id, term }. Take the term.
    if (typeof v.term === 'string') return v.term;
    if (typeof v.name === 'string') return v.name;
    return '';
  }
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}
