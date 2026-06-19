# SESSION PROMPT — EUDAMED queue: candidate recompute + manual review (gate 1 for discovery)

> *Supersedes `SESSION-PROMPT-eudamed-requeue-rescore.md`, which was wrong:* that
> draft assumed the 227 pending rows had been scored through the buggy
> `eudamed.ts` detail path and needed a live name re-fetch. They weren't — they
> were **consumed from the 9-June crosswalk JSON** (`seed-eudamed.ts`:
> `device_name = euTradeName`, candidate Dice = `nameDice`), so the name fix
> isn't in their lineage. The real job here is the FDA-dedup candidate re-point,
> which makes **no EUDAMED calls**. Discard the old prompt.

---

## Context

I'm Annemarie, sole dev/owner of the Aletia Index (cross-jurisdiction AI/ML
medical-device identity reconciliation; Next.js/TS on Vercel, Supabase Free-plan,
public repo `AnnMaidment/Aletia-Index` on `main`). Recent commits:
`706054b` (11 Jun, FDA dedup + `merged_into`), `9bc175e` (17 Jun, HAIR Step 1a),
`e7a4cea` (19 Jun, EUDAMED localised-text Bugs A/B/C fixed). So **gate condition
3 (lib/eudamed.ts bugs) is cleared.** The remaining gate before Step 1b is
**gate condition 1: manual queue review of the 227 pending `eudamed_sync` rows**,
which starts with the candidate recompute below. See `STATE.md`,
`HANDOVER_2026-06-17_hair-extraction.md` ("Next" #2), `EUDAMED-STEP-0A-FINDINGS.md`.

## Session-start ritual (do first, before writing anything)

1. Refresh the repo; confirm `e7a4cea` is at the head of `main`. Code is ground
   truth over docs. Tarball: `/archive/refs/heads/main.tar.gz`;
   `raw.githubusercontent.com` for single files; `.../commits/main.atom` for head
   (note: `api.github.com` is rate-limited on shared egress — use the atom).
2. Read Tier-1 docs: `STATE.md`, `TODO.md`, `KNOWN-BUGS.md`.
3. Read end-to-end before touching anything: `lib/fdaDedup.ts` (`merged_into`
   survivor semantics), `lib/matchingCandidates.ts`, the seeded shape in
   `scripts/seed-eudamed.ts`, and `app/api/admin/queue/candidates/route.ts`
   (compute-once behaviour — why stored candidates don't auto-refresh).

## The state of `recompute-eudamed-candidates.ts`

It was **written in the 17 June HAIR session but NOT committed** (deliberately
left out of that session's `git add`; it's local-only on the dev machine). So:
first **locate the local copy and read it** against the current repo — confirm it
still matches `lib/fdaDedup.ts` / the queue schema, since it predates nothing but
hasn't been re-grounded. If it's lost, re-derive it from `lib/fdaDedup.ts` +
`matchingCandidates.ts`. **Committing it is part of this session's deliverable.**

## What the recompute does (and does NOT do)

- **Does:** re-resolve the 227 pending `eudamed_sync` rows' `possible_merge_candidates`
  against **post-Band-A-dedup FDA identities** — Band A tombstoned 214 rows via
  `device_master.merged_into`, and some were candidate targets for these EU rows.
  The recompute re-points each candidate onto its survivor so the drawer shows
  correct merge targets. This is exactly what unblocks the **68 multi-candidate
  rows that were held pending the FDA collapse** (STATE next-priority #2).
- **Does NOT:** call EUDAMED, re-fetch names, or re-derive the crosswalk. It is a
  pure DB re-point. The 19-June name fix is **irrelevant** to it (the name fix
  matters for *future* live discovery / Step 1b, not these seeded rows).

## Task

1. Locate + re-ground the local `recompute-eudamed-candidates.ts`; read it against
   current code.
2. **Dry-run** (default). Review the report: rows processed, candidates re-pointed
   onto survivors, and the invariants **tombstone-hops = 0** (no candidate still
   points at a `merged_into IS NOT NULL` row after the pass) and
   **no-crosswalk-entry = 0**. Eyeball the first sample.
3. **Snapshot `ingestion_review_queue`** (Free plan, no backups), then `--apply`
   with the `--expect N` drift guard (writes a rollback file).
4. **Commit** the recompute script to `main`.
5. **Work the queue** in the admin drawer: the 159 single-candidate EUDAMED rows
   (merge → EU `regional_registrations`, `reg_count` 1→2), then the 68
   now-collapsible multi-candidate rows. The 80 `fda_dedup` Band-B+C rows can be
   worked in the same drawer session if there's time (clean re-codes first; the
   flagged judgement calls — Aidoc BriefCase, SOZO ×4, Clarius — parked for a
   decision).

## Discipline / constraints

- A bad cross-jurisdiction merge is the most damaging error this product makes —
  **false positives are worse than duplicates.** The recompute only refreshes
  *candidates*; it must not auto-accept or touch `device_master`. In the drawer,
  **park multi-candidate rows** rather than forcing an accept against an FDA
  fragment.
- Snapshot before `--apply`. `npx tsx` on Windows/PowerShell; UTF-8 files, never
  paste TS at the PS prompt; single-line `-m`. Probe scripts use `probe-*`
  (tsconfig-excluded).
- Verify live (one row, then the dry-run report) over theoretical answers. Flag
  judgement calls for my decision.
- `tsc --noEmit` + eslint clean before committing. Complete file replacements
  over diffs.
- **"Done" = committed to `main` and verified in production** (re-pointed
  candidates visible in the drawer; a sample of the 68 now resolving to a single
  survivor).

## After this (do not start — just so you know where it leads)

With gate 1 (this queue review) and gate 3 (the bug fix) both cleared, **Step 1b
— the HAIR three-way reconcile** (each of the 400 HAIR products vs the Aletia 4d
gate + the EUDAMED `tradeName` crosswalk) is unblocked. It **writes to the queue**
and is the next session after this. Then **Step 1c — recall measurement** off the
HAIR snapshot (the funder-report headline). Note for 1c: a fraction of EUDAMED
devices have empty `tradeName.texts[]` (un-nameable from the public surface) and
Dice-zero in the gate — a source-side floor on EU crosswalk recall, to be
reported as such, not treated as a miss.
