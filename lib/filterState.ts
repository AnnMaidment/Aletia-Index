/**
 * Shared filter-state reader for the main index page.
 *
 * The home page (and, ahead, the placement panel) both need to derive the
 * "what is the user currently filtering on" answer from URLSearchParams.
 * Until now that logic lived inline in `app/components/FiltersBar.tsx` —
 * fine for one caller, brittle for two.
 *
 * This module is a pure function over a URLSearchParams-shaped object plus
 * the matching TypeScript type. It deliberately does not import from
 * `next/navigation` so it is callable from server components, client
 * components, route handlers, or unit tests with equal ease.
 *
 * One quirk preserved from the prior inline logic: the `pccp` param falls
 * back to `'approved'` when missing AND when present-but-empty (i.e. `?pccp=`
 * in the URL). The original used `searchParams.get('pccp') || 'approved'`,
 * not `?? 'approved'`. Empty-string `pccp` is treated identically to absent.
 */

/**
 * Minimal shape consumed by `getCurrentFilterState`. Both Web URLSearchParams
 * and Next's ReadonlyURLSearchParams satisfy this — the function does not
 * care which one is passed.
 */
export interface SearchParamsLike {
  get(name: string): string | null
}

/**
 * The four user-controllable filter axes plus the three mode flags that
 * combine to produce the "view" the user is looking at.
 *
 * Axes (what the user is filtering on):
 * - `search`         — free-text query (empty string when no search active)
 * - `specialty`      — clinical specialty filter; `'All'` when unfiltered
 * - `source`         — data-source filter; `'All'` when unfiltered
 * - `status`         — health status (`Green` / `Amber` / `Red`) when not in
 *                      pipeline mode; pipeline sub-stage label when it is;
 *                      `'All'` when unfiltered
 *
 * Modes (which view of the corpus the user has picked):
 * - `pccp`           — `'approved'` shows only PCCP-authorised devices
 *                      (the default), `'all'` shows the full corpus
 * - `autonomous`     — `'true'` when the Autonomous-Output view is active
 * - `pipeline`       — `'true'` when the Pipeline view is active
 *
 * Convenience:
 * - `isPipelineMode` — derived from `pipeline === 'true'`. Kept on the
 *                      returned object so consumers don't all re-derive.
 */
export interface FilterState {
  search: string
  specialty: string
  status: string
  source: string
  pccp: string
  autonomous: string
  pipeline: string
  isPipelineMode: boolean
}

/**
 * Read the current filter state from a URLSearchParams-like object.
 *
 * Defaults match the pre-refactor inline logic in FiltersBar exactly. If
 * those defaults need to change, change them here once and every consumer
 * picks the new behaviour up.
 */
export function getCurrentFilterState(searchParams: SearchParamsLike): FilterState {
  const pipeline = searchParams.get('pipeline') ?? ''

  return {
    search:     searchParams.get('search')     ?? '',
    specialty:  searchParams.get('specialty')  ?? 'All',
    status:     searchParams.get('status')     ?? 'All',
    source:     searchParams.get('source')     ?? 'All',
    // `|| 'approved'` (not `??`) — empty string `?pccp=` also falls back to
    // the default. Matches the pre-refactor behaviour; do not "fix" to `??`.
    pccp:       searchParams.get('pccp') || 'approved',
    autonomous: searchParams.get('autonomous') ?? '',
    pipeline,
    isPipelineMode: pipeline === 'true',
  }
}
