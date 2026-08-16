# DIAMOND — Claude Working Notes

Local-first Next.js fantasy baseball dashboard, deployed to Vercel. Full project spec lives in `SCOUT_README.md` — read it on session start.

## Environment

- `~/Desktop/fantasy-baseball` — project root
- Home dir: `/Users/jodran` (note: `jodran`, not `jordan`)
- macOS, Node v24. No DB — JSON files only.

## Working Rules

1. **Read before editing.** No guessing at structure, imports, types, or signatures. Use line ranges (`view lines 45-60`) when possible — don't slurp whole files for one-line questions.
2. **Surgical patches only.** Smallest possible diff. Never rewrite a file to change one line.
3. **`node -e` with single quotes inline.** No temp scripts in the project. `/tmp/` allowed for complex multi-step diagnostics only — clear before any push: `rm -f /tmp/*.js /tmp/*.py`.
4. **Terse.** No preamble, no recap, no "let me know if…". Patch and stop.
5. **Verify before asserting.** `grep`/`cat`/`ls` before claiming anything about file contents.
6. **No hardcoded years.** Use `new Date().getFullYear()`.
7. **`jodran`, never `jordan`** in paths.

## Token & Error Guardrails

- **Reference `@SCOUT_README.md` rather than restating it.** Don't recap project structure in responses.
- **Plan before patching anything non-trivial.** 3–5 bullet plan → wait for confirm → patch. Surfaces wrong assumptions before they hit disk.
- **One file at a time.** If a change spans multiple files, do them sequentially with confirmation between, not as one mega-patch.
- **Stop on uncertainty.** If a field name, file shape, or function signature isn't verified, say so and read the file. Do not guess.
- **No exploratory `cat` on large JSON.** Use `jq` or `head` with line ranges. `players.json` and `history/*.json` are large.
- **Don't re-explain what was just done.** If the patch is shown, that's the explanation.

## Critical Git Workflow

GHA runs nightly at 1am PT — **remote is almost always ahead.**

```bash
rm -f /tmp/*.js /tmp/*.py
git add -A && git commit -m "..." && git push --force
```

- Never `git pull --rebase` (detached HEAD)
- Never `git reset --hard` without confirming local saved
- Never `git merge` after GHA push — local is source of truth
- After GHA conflict: see `SCOUT_README.md` recovery block. Always re-run full pipeline (norms → regression → scores → model-rank → blend-rank → call-ups) after pulling data files.

## Architecture Tripwires

These cause silent breakage if missed. Full details in `SCOUT_README.md`.

- **`stats.json` is RETIRED** — current season lives in `history/2026.json` keyed by `mlbam_id`.
- **Two sync files must stay in lockstep:** `scripts/sync-stats-gha.js` and `app/api/stats/sync/route.ts`. Update both together.
- **`FRIEND_TEAMS` color map duplicated in 5 files** (`PlayerRow.tsx`, `app/players/page.tsx`, `app/hot-sheet/page.tsx`, `components/players/PlayerDrawer.tsx`, `app/leagues/[id]/page.tsx`). Patch all five.
- **Two-way players:** `isPitcher()` / `isTwoWay()` must check ALL positions, not just first. `scoreTool` must filter by `s.type === expectedType` to prevent cross-contamination.
- **Pipeline order is mandatory:** norms → mlb-tools → regression → peak-tools → peak-regression → worthy-calibration → fantasy-peak → scores → model-rank → blend-rank → call-ups → comp-pool. Never run `build-scores.js` without a fresh `regression.json`. Skipping `build-callups.js` doesn't error — it just silently reverts Call-Ups to whatever stale copy was last committed locally, even though GHA regenerates it correctly every night. `peak-tools`/`peak-regression`/`worthy-calibration`/`fantasy-peak-regression` feed `career_blend.peak3`/`.worthy_pct`/`.worthy_actual`/`.fantasy_peak3` only — additive display stats, never read by `dynasty_score`/model-rank/blend-rank. `fantasy_peak3` is prospects-only by design (graduated players get `null` — real stats exist, a projection would be noise). `build-comp-pool.js` writes `career_blend.comp_ceiling`/`.comp_floor` and MUST run last — `build-scores.js` rebuilds `career_blend` from scratch every run and silently drops those fields if comp-pool doesn't run after it (bit us in GHA — the daily workflow was missing this step, wiping comps nightly).
- **`POOL_CENTER = 95`** (not 100). Don't change without understanding cascade.
- **`VirtualList.tsx` freeze-pane** uses hidden synced header + `onHScroll`. Preserve on scroll edits.
- **Next.js 16 dynamic routes:** `params` is a Promise — `await params` before destructuring.
- **`DATA_BASE` env var** controls data root. Don't hardcode paths.

## What NOT to Do

- Edit files unread this session
- Reference `stats.json`
- Run `build-scores.js` with stale `regression.json`
- `git pull --rebase` or `git merge` after GHA push
- Hardcode the year
- Patch one copy of duplicated code (FRIEND_TEAMS, sync files) without finding the others
- Create temp `.js`/`.py` files in the project
- Rewrite whole files for small fixes
- Write `jordan` anywhere

## Test Subjects

| Role | Name | mlbam_id |
|------|------|----------|
| MLB Bat | Aaron Judge | 592450 |
| MLB Arm | Tarik Skubal | 669373 |
| MiLB Bat | Jesus Made | 815908 |
| MiLB Arm | Quinn Matthews | 687273 |
| Two-way MLB | Shohei Ohtani | 660271 |
| Two-way MiLB | Josh Owens | 831384 |

## Output Format

- **Small change:** exact `node -e` one-liner or `sed` block. No prose.
- **Multi-file:** sequential commands, confirm between.
- **New feature:** plan → confirm → patch.
- **Debug:** read file → state actual cause → fix.
- **After pipeline-touching change:** remind of rebuild + force-push.
