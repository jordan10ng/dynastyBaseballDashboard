# DIAMOND — Fantasy Baseball Dashboard
Built with the user in successive Claude sessions. Deployed at https://dynasty-baseball-dashboard.vercel.app/

## Start
```bash
cd ~/Desktop/fantasy-baseball
caffeinate -i & npm run dev
# → localhost:3000
```

## Stack
- Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS
- No database — JSON files only
- Node.js v24, Mac only

## Deployment
- Deployed on Vercel at https://dynasty-baseball-dashboard.vercel.app/
- GitHub: https://github.com/jordan10ng/dynastyBaseballDashboard (public repo)
- Push to deploy: `git add -A && git commit -m "..." && git push`
- Rankings and Sync pages hidden on deployed version via `NEXT_PUBLIC_SHOW_ADMIN` env var
- Set `NEXT_PUBLIC_SHOW_ADMIN=true` in `.env.local` to show them locally
- ⚠️ GHA bot commits cause a push conflict if you push while workflow is running
- GHA only touches data files — scripts are never modified by GHA. Safe recovery:
  ```bash
  git fetch origin
  git checkout origin/main -- data/history/2026.json data/players.json data/model/norms.json data/model/mlb-tools.json data/model/regression.json data/model/hot-sheet.json data/model/scores-snapshot.json
  node scripts/build-norms.js && python3 scripts/build-regression.py && node scripts/build-scores.js
  git add -A && git commit -m "..." && git push
  ```
- ⚠️ CRITICAL: After GHA recovery, always re-run the FULL pipeline (norms → regression → scores). Pulling data files from GitHub overwrites locally-built model files. Never run build-scores.js without first rebuilding regression.json from the current scripts.
- DO NOT use `git pull --rebase` — causes detached HEAD and loses local file changes
- DO NOT use `git reset --hard` before verifying local changes are committed or saved elsewhere

## Daily Sync (GitHub Actions)
- Runs every night at 1am PT (9am UTC) via `.github/workflows/daily-sync.yml`
- Pipeline: sync-stats-gha.js → build-norms → build-mlb-tools → build-regression → build-scores
- Commits updated `data/history/2026.json`, `data/players.json`, `data/model/*.json` to GitHub
- Vercel detects the push → auto-redeploys with fresh data
- Can also trigger manually: https://github.com/jordan10ng/dynastyBaseballDashboard/actions → Daily Stats + Model Sync → Run workflow
- `GH_PAT` secret (repo + workflow scope) stored in GitHub repo secrets — needed for bot commits
- `DATA_BASE` env var controls data root in all scripts — defaults to `~/Desktop/fantasy-baseball/data` locally, set to `$GITHUB_WORKSPACE/data` in GHA
- Local sync works via the Sync page (admin only) — runs identical pipeline to GHA

## Directory Tree
fantasy-baseball/
├── .github/
│   └── workflows/
│       └── daily-sync.yml                # GHA cron — 1am PT daily stats + model rebuild
├── app/
│   ├── page.tsx                          # Home/command center
│   ├── players/page.tsx                  # Main hub — computeTools() blends MiLB+MLB for grads
│   ├── hot-sheet/page.tsx                # Hot sheet — biggest model gainers this season
│   ├── rankings/page.tsx                 # Multi-source ranking system (admin only)
│   ├── sync/page.tsx                     # Fantrax + stats sync (admin only)
│   ├── trade/page.tsx
│   ├── leagues/page.tsx                  # League list
│   ├── leagues/[id]/page.tsx             # League detail — roster by position group, MY_TEAM highlight
│   └── api/
│       ├── players/route.ts, all/route.ts, import/route.ts
│       ├── rankings/route.ts             # Legacy direct import
│       ├── rankings/import/route.ts      # Multi-source import engine
│       ├── rankings/compute/route.ts     # Weighted consensus engine
│       ├── stats/route.ts               # Serves current season stats from history/2026.json (mlbam_id → Fantrax ID bridge). Two-way players: hitting under fantraxId, pitching under fantraxId + '_pit'
│       ├── stats/link/route.ts, sync/route.ts
│       ├── stats/history/[mlbamId]/route.ts  # Career history from local YYYY.json files
│       ├── model/tools/route.ts          # Serves mlb-tools.json to UI
│       ├── hot-sheet/route.ts            # Serves hot-sheet.json to UI
│       ├── leagues/route.ts, [id]/teams/route.ts, [id]/rosters/route.ts
│       └── fantrax/sync/route.ts, connect/route.ts
├── components/
│   ├── layout/Sidebar.tsx                # Desktop sidebar + mobile bottom tab bar
│   └── players/
│       ├── PlayerRow.tsx
│       ├── PlayerDrawer.tsx              # Full-screen player detail — blends MiLB+MLB tools for grads. BAT/ARM toggle for two-way players.
│       ├── StatcastPanel.tsx             # Statcast data visualization
│       └── VirtualList.tsx              # Virtualized list with onHScroll callback
├── lib/
│   ├── db.ts                            # JSON file I/O, absolute path helpers
│   ├── fantrax.ts                       # Fantrax API client
│   ├── players-config.ts                # Real exports: LEAGUES, MY_TEAM, isPitcher, cleanPositions, toolColor
│   ├── drawer-utils.ts                  # Player drawer helpers: sportAbbrToLevel, levelSortVal, sumBatStats, sumPitchStats, calcKPct/BBPct, etc.
│   ├── statcast-utils.ts                # Statcast helpers: parseStatcastCSV, PITCH_COLORS, PITCH_ORDER, getStatColor, fmtN, pct, avg
│   └── useDrawerData.ts                 # Hook to fetch stats and MLB tools data for drawer
├── scripts/
│   ├── build-history.js                 # MLB stat pull — resume-capable
│   ├── build-history-milb.js            # MiLB stat pull — resume-capable
│   ├── build-birthdates.js              # One-off DOB pull (already run)
│   ├── build-norms.js                   # Level/league norms → data/model/norms.json. Blends current year with prior year weighted by sample size (blend = min(n/400, 1.0)).
│   ├── build-mlb-scores.js              # MLB fantasy point rates → data/model/mlb-scores.json
│   ├── build-mlb-tools.py               # MLB career tool grades → data/model/mlb-tools.json. Two-way players get type:'two-way' with all 5 tools.
│   ├── build-age-elasticity.py          # Per-stat age elasticity → data/model/age-elasticity.json (reference only, not in pipeline)
│   ├── build-regression.py              # Two-feature regression (z + age_diff) → data/model/regression.json
│   ├── build-scores.js                  # Scores prospects → players.json model_scores + hot-sheet.json. Two-way players scored on both sides independently.
│   └── sync-stats-gha.js               # Standalone stats sync for GHA — writes to history/2026.json. Two-way players fetch both hitting + pitching groups.
├── data/
│   ├── players.json                      # PERMANENT — never wipe. Has birthDate, mlbam_id, rank, model_scores.
│   ├── db.json                           # LIVE — safe to re-sync
│   ├── razzball.csv                      # ID bridge, update periodically
│   ├── rankings/
│   │   ├── sources/                      # Raw imported ranking sources (YYYYMMDD_name.json)
│   │   └── rankings.json                 # Computed consensus output
│   ├── history/
│   │   ├── progress.json                 # MLB pull resume tracker
│   │   ├── progress-milb.json            # MiLB pull resume tracker
│   │   └── YYYY.json                     # All player stat lines for that year (MLB + MiLB). 2026.json = source of truth for current season.
│   └── model/
│       ├── norms.json                    # Level/league/year stat norms. Current year blended with prior year (blend = min(n/400, 1.0)).
│       ├── mlb-scores.json               # Per-season MLB fantasy point rates (pts/PA, pts/IP)
│       ├── mlb-tools.json                # MLB career tool grades per player — graduation truth source. Has _pa/_ip sample counts. Two-way: type:'two-way' with hit/power/speed/stuff/control + _pa + _ip.
│       ├── age-elasticity.json           # Per-stat per-level age elasticity — reference only, not used in pipeline
│       ├── regression.json               # Per-tool per-level two-feature model (slope_z, slope_age, intercept, corr, n)
│       ├── hot-sheet.json                # Generated by build-scores.js — top 20 bats + top 20 arms (IP/GS >= 3.0) by season delta
│       └── scores-snapshot.json          # Point-in-time snapshot of model overall + _sample per player

## Mobile
- Responsive layout for phone browsers (768px breakpoint)
- **Sidebar** — hidden on mobile, replaced with bottom tab bar (icons + labels)
- **Players page** — mobile renders slim list: RK · PLAYER (name/pos/team/level/stats) · OVR+. Paginated 75 at a time with Load More. RK and OVR+ headers are both tappable to sort. All desktop filters work on mobile.
- **Hot sheet** — mobile renders delta + stacked info (name · pos/team/level · stat line · tool line). Desktop grid unchanged.
- **Trade calculator** — stacks Team A / verdict / Team B vertically on mobile instead of side-by-side.
- **Player drawer** — already worked well on mobile, unchanged.

## Data Architecture
- **players.json** — ~10k players. id, name, team, positions, level, age, rank, mlbam_id, fangraphs_id, birthDate, model_scores. Never wipe. `rank` written by compute engine. `model_scores` written by build-scores.js.
- **db.json** — leagues, teams, rosters. Safe to delete + re-sync.
- **stats.json** — RETIRED. Deleted. Current season stats now live in `history/2026.json`.
- **history/YYYY.json** — all player stat lines for that year keyed by mlbam_id. Each entry is an array of rows (one per level played). Current season rows tagged with `_season` and `_synced`. 2026.json updated nightly by GHA and on-demand via Sync page.
- **rankings/sources/** — one JSON per imported ranking source. Never auto-deleted.
- **rankings/rankings.json** — computed consensus output. Rewritten on each compute.
- **model/norms.json** — level+league+year stat norms. Primary key: `"AA|2023"`. Current year norms blended with prior year: `blend = min(n/400, 1.0)`. Rebuild by running `build-norms.js`.
- **model/mlb-scores.json** — per-season MLB fantasy point rates. Rebuild by running `build-mlb-scores.js`.
- **model/mlb-tools.json** — per-player career MLB tool grades keyed by mlbam_id. **Source of truth for MLB vs minors designation** — presence = graduated. Has `_pa`/`_ip` sample counts used for blending. Two-way players: `type: 'two-way'` with all 5 tools + both `_pa` and `_ip`. Rebuild by running `build-mlb-tools.py`.
- **model/regression.json** — per-tool per-level two-feature model. Keys: `slope_z`, `slope_age`, `intercept`, `corr`, `n`. Rebuild by running `build-regression.py`.
- **model/hot-sheet.json** — top 20 bats + 20 arms (IP/GS >= 3.0, excludes relievers) by current season model delta. Written by build-scores.js every run.
- **model/scores-snapshot.json** — snapshot of model scores keyed by Fantrax ID. Written as comparison baseline.

## Fantrax Integration
- League IDs: `0ehfuam0mg7wqpn7` (D28), `ew7b8seomg7u7uzi` (D34), `d3prsagvmgftfdc3` (D52)
- Cookie expires — re-grab from Chrome DevTools → Network → any fantrax.com request → `cookie:` header → paste into .env.local as `FANTRAX_COOKIE=...`

## Stats Integration (MLB Stats API — free, no key)
### 4-step sync (Sync page — admin only):
1. Import Player Database — Fantrax CSV → players.json (one-time)
2. Sync Leagues — Fantrax API → db.json
3. Link Player IDs — razzball.csv + MLB API name fallback → mlbam_id on players.json (~92% coverage)
4. Sync Stats — MLB API season stats → history/2026.json, then runs full model pipeline. Takes 5-10 min.

## My Team
**Winston Salem Dash** — gold (#f59e0b) throughout. `MY_TEAM` constant in players/page.tsx.

## Players Page
- All data loads on mount
- League → team → ownership column
- 3 colored dots per player per league (green=mine, yellow=owned, red=FA)
- Green M badge = MINORS status from mlb-tools.json presence check
- Filters: All/Mine/Owned/FA/Mine+FA · All/MLB/Minors · All/Bats/Arms (independent, combinable)
- Advanced filters: Rank range, Age, Position multi-select, Level multi-select, MLB Team
- Stat filters: stackable per-stat min/max, only in Bats/Arms mode
- All mode shows compact stat blurb below name (OPS·K%·BB%·HR·SB for bats, W-L·IP·ERA·K%·BB% for arms)
- Bats columns: G · BA · OBP · SLG · OPS · SO · BB · PA · AB · H · 2B · 3B · HR · R · RBI · SB · CS · ISO · K% · BB% · XBH%
- Arms columns: G · W-L · IP · BAA · ERA · WHIP · H · ER · BB · SO · K% · BB% · K-BB% (R and HR removed — not tracked in pitching history rows)
- Freeze panes: #/RK/POS/PLAYER sticky left (POS dropped in All mode); header syncs horizontally with rows
- Mobile: RK and OVR+ headers tappable to sort; all filters available; paginated 75 at a time
- **Tool display for graduated players** — `computeTools()` blends model_scores (MiLB) with mlb-tools.json (MLB actuals) weighted by sample size (_pa/_ip)
- **Two-way players** — appear in both Bats and Arms filters. Bats mode shows hit_overall, Arms mode shows pitch_overall, All mode shows blended overall (50/50).

## Player Drawer (full screen)
Click any player → full screen overlay. Escape or ✕ to close.

### Two tabs: Stats · Statcast

### Stats tab:
- Bio strip: B/T · HT/WT · Born · Debut · Draft
- Stat tiles: ERA + K-BB% (arms) or K% + BB% (bats)
- Career table: yearByYear MLB + MiLB. MiLB rows indigo tint. Collapsible multi-team seasons.
- Tool tiles: per-tool show value · ▲raw (ceiling) · conf% — raw/conf hidden for graduated players (blended tools)
- **Two-way players** — BAT/ARM toggle appears next to STATS/STATCAST tabs. Flips career table, recent, splits, game log, statcast, and tool tiles to the selected side. Defaults to ARM.

### Statcast tab:
- Hitters: EV tiles, expected stats, batted ball, plate discipline, spray chart, vs pitch type
- Pitchers: EV against, pitch movement chart, pitch mix table, plate discipline
- ⚠️ Pitcher chart incomplete — movement plot only, no release point scatter (see Next Priorities)

## Ranking System
- **O** (Overall), **P** (Prospect), **X** (Open Universe/tier) source types
- Weighted consensus engine with staleness decay (100% at day 0 → 0% at day 365)
- Writes rankings.json and patches rank field in players.json

## Proprietary Ranking Model (`data/model/`)

**Tools:** Hit+ (k%+bb%), Power+ (iso), Speed+ (sb_rate) for hitters. Stuff+ (k%), Control+ (bb%) for pitchers. 100 = average among scored prospects (pool-normalized). 115 = elite prospect, 130 = generational.

**Pipeline:**
1. `build-norms.js` → norms.json
2. `build-mlb-tools.py` → mlb-tools.json (training targets)
3. `build-regression.py` → regression.json
4. `build-scores.js` → model_scores on players.json + hot-sheet.json

**Scoring architecture (build-scores.js):**
- Regression predicts MLB tool grade from MiLB stats using a two-feature model per season per level per stat: `pred = slope_z × z + slope_age × ageDiff + intercept`. Age is a learned feature in the regression, not a post-hoc adjustment.
- `ageDiff = AVG_AGE[level] - playerAge` at time of that season. Positive = young for level (good). Speed (sb_rate) uses single-feature model (slope_age=0) — age has no signal for speed.
- AVG_AGES derived from actual history data: DSL=17.9, Complex=19.9, Rookie=20.4, Single-A=21.3, High-A=22.6, AA=24.0, AAA=26.4
- Pool re-normalization: raw regression outputs re-centered to prospect pool mean=100, stdev=15. Necessary because regression output range is narrow (~93-107) due to weak MiLB→MLB correlation. Renorm creates usable separation.
- Shrinkage toward 88 (prior = below-average MLB): `score = 88 + (normed - 88) × (sample / (sample + K))`
- Per-stat stabilization K values: hitters k%=60 PA, bb%=120 PA, iso=120 PA, sb_rate=60 PA; pitchers k%=20 IP, bb%=40 IP
- Rookie eligibility: < 130 MLB AB (hitters) or < 50 MLB IP (pitchers) — uses history files
- `age-elasticity.json` is no longer used in the pipeline — age signal is baked into regression.json coefficients
- **Two-way players**: both sides scored independently using type-filtered history rows (hitting rows for hit tools, pitching rows for pitch tools). `model_scores` stores all 5 tools + `hit_overall`, `pitch_overall`, and blended `overall` (50/50). Pure players unchanged.

**Norm blending (build-norms.js):**
- MIN_PA=0 so all current season rows contribute
- Current year level norms blended with prior year: `blend = min(curN / 400, 1.0)` where curN = qualifying player-seasons at that level
- At season start (n≈0): 100% prior year norms. At ~400 qualifying seasons: 100% current year.
- Prevents garbage early-season norms from corrupting z-scores (e.g. AA|2026 had n=4 stored vs n=202 actual before fix)

**Hot sheet:** Risers = rookie-eligible players whose overall(with CY) - overall(without CY) ≥ 1. Arms filtered by IP/G >= 3.0 (total games denominator, not GS — catches openers, allows RP-tagged starters). Sorted by delta desc, then overall.

**Displayed tools for graduated players:** Blend of MiLB model_scores and mlb-tools.json actuals, weighted by sample (MiLB _sample vs MLB _pa/_ip). Raw ceiling and confidence hidden for blended players.

## Two-Way Player Architecture
Two-way = player has at least one arm position (SP/RP/P) AND at least one non-arm position in `positions` field.

**Detection:** `isTwoWayPlayer(positions)` / `isTwoWay(positions)` used in page.tsx, PlayerRow.tsx, PlayerDrawer.tsx.

**Scoring (build-scores.js):**
- Both sides always scored using type-filtered history rows
- `scoreTool` filters by `s.type === expectedType` to prevent cross-contamination
- `model_scores` shape for two-way: `{ hit, power, speed, stuff, control, hit_overall, pitch_overall, overall, _raw, _confidence, _sample }`
- `overall` = 50/50 blend of hit_overall and pitch_overall (PA and IP not comparable so equal weight)
- Players with only arm positions (e.g. McLean SP): both sides calculated internally but only pitch side exposed

**MLB tools (build-mlb-tools.py):**
- Two-way players get `type: 'two-way'` entry with all 5 tools + `_pa` (hitting sample) + `_ip` (pitching sample)
- `career_pitcher` threshold: total career MLB IP >= 50 (not per-season)
- Single-side players unchanged

**Stats route (api/stats/route.ts):**
- Two-way players: hitting stats under `fantraxId`, pitching stats under `fantraxId + '_pit'`
- UI reads `effectiveStats(player)`: bats mode → fantraxId (null if group=pitching), arms mode → fantraxId + '_pit'

**Stat sync (sync-stats-gha.js + api/stats/sync/route.ts):**
- Two-way players fetch both `group=hitting` and `group=pitching` from MLB Stats API
- Both sets of rows written to history/YYYY.json under same mlbam_id

**Players page display:**
- Bats filter: two-way players included, show hit_overall as OVR+, hitting stats
- Arms filter: two-way players included, show pitch_overall as OVR+, pitching stats
- All filter: blended overall shown

**Player drawer:**
- BAT/ARM toggle (green pill buttons) visible only for two-way players, next to STATS/STATCAST tabs
- `pitch` flag derived from `twoWaySide` state for two-way players
- All sections (career table, recent, splits, game log, statcast, tool tiles) respond to toggle
- Tool tiles show only the active side's tools + that side's OVR+

## Trade Calculator
- Open mode or league mode (pick teams)
- Value: exponential decay 0.9942^(rank-1). Rank 1 = 100pts.
- Draft picks: 1st=10, 2nd=4, 3rd=2
- Mobile: vertical stack

## Next.js 16 Gotcha
```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}
```

## Next Priorities (in order)
1. **Statcast pitcher chart** — unified release point + movement plot
2. **Model as consensus source** — add model scores as source type M in ranking engine
3. **Roster moves** — add/drop via Fantrax API, needs session auth
4. **Trade calculator** — connect to model scores instead of placeholder exponential decay
5. **emerging** best new raw tools with X confidence

## Known Issues
- ~13% of rostered players not in players.json (post-export prospects)
- Fantrax cookie expires, manual refresh needed
- Trade calculator not connected to model scores
- oObp/oSlg only for single-team pitching seasons
- Statcast pitcher chart incomplete (movement only, no release point scatter)
- ~20 remaining mlbam_id duplicate pairs — benign
- ⚠️ `build-age-elasticity.py` and `build-mlb-scores.js` NOT in auto-run pipeline — run manually
- Hot sheet early season produces mostly small deltas — correct behavior, shrinkage handles small samples
- Players near the hot sheet delta threshold may fall on/off with small sample changes — expected
- High-recency players (>50% of career sample from current season) are systematically under-valued vs consensus — model sees small sample + shrinkage, scouts already know the player. No clean fix without scout signal — that's what scouting is for.
- Old players with large career samples (age 25+, sample 1000+) can appear overvalued vs consensus — career sample increases confidence which inflates score

## Fixed (Apr 2026)
- sportId=21 phantom entries excluded — 17,663 rows scrubbed
- DSL mislabeled as Complex — fixed by splitting on league name
- Pitcher regression zero coefficients — k/bb_allowed field name mismatch fixed
- M badge now uses mlb-tools.json presence check
- Career stats from local history files (no external API call)
- Drawer tool tiles with ceiling + confidence
- **Mobile layout** — bottom tab nav, mobile players/hot-sheet/trade, pagination
- **Deployed to Vercel** — https://dynasty-baseball-dashboard.vercel.app/
- **Admin pages hidden on deploy** via NEXT_PUBLIC_SHOW_ADMIN env var
- **GitHub Actions daily sync** — 1am PT cron, full pipeline, auto-deploys to Vercel
- Mine+FA filter added
- All mode stat blurb added to players page
- Players page: RK column clickable sort; All mode folds pos/team/level into name line, drops POS column
- Players page mobile: pos/team/level + dots on name line; RK + OVR+ headers tappable to sort
- Hot sheet: G/IP added to stat line; mobile tool colors per-tool; pos/team/level on name line
- **Model rebuild (Apr 2026):**
  - Age adjustment moved into z-space per season per level per stat (was additive post-normalization flat bonus)
  - Pool re-normalization kept (center=100, stdev=15)
  - Shrinkage toward 88 (was toward 100)
  - Per-stat stabilization K values implemented
- **Two-feature regression (Apr 2026):**
  - age_diff added as explicit second feature in regression training alongside z-score
  - Replaces previous elasticity-based z-nudge (corr_age_residual × ageDiff × 0.2) which was too weak and got compressed by pool renorm
  - age-elasticity.json retained as reference but removed from pipeline
  - AVG_AGES updated to real empirical values derived from history data
  - Age vs Level correlation with rank gap dropped from +0.052 to ~0.000
  - Old-for-level players appropriately penalized; young-for-level appropriately rewarded
- **Norm blending (Apr 2026):**
  - build-norms.js MIN_PA lowered to 0 so all current season rows contribute
  - Current year norms blended with prior year weighted by sample size (blend = min(n/400, 1.0))
  - Fixes early-season garbage norms that were corrupting z-scores (AA|2026 had n=4 stored vs n=202 actual)
- **Hot sheet RP exclusion updated (Apr 2026):** Arms filtered by IP/GS >= 3.0 instead of position string — more robust, catches openers, excludes true relievers regardless of position tag
- **Graduated player tool blending (Apr 2026):**
  - computeTools() in page.tsx and toolGrades in PlayerDrawer.tsx blend MiLB model scores with MLB actuals
  - Weighted by sample: MiLB _sample vs mlb-tools.json _pa/_ip
  - Raw ceiling + confidence hidden in drawer for blended (graduated) players
  - Overall recomputed from blended tools using standard weights
- **Raw tools view (Apr 2026):** RAW button on players page (Bats/Arms only). Shows pre-shrinkage _raw tool grades. Minors-only — MLB shows —. Sortable. Selecting RAW forces Minors filter; leaving Minors exits RAW.
- **Friend team colors (Apr 2026):** D52 dots/buttons/league page colored per friend. Jordan green in all leagues. Others D52-only. Ownership filter replaced with named dropdown.
- **Hot sheet IP/G fix (Apr 2026):** Filter uses total games not GS. Catches openers and RP-tagged starters.
- **MiLB level resolution fix (Apr 2026):** Both sync files now use sportId fallback. Fixes players labeled MiLB instead of correct level. Backfill applied to 2026.json.
- **stats.json retired (Apr 2026):**
  - Current season stats now written to history/2026.json (keyed by mlbam_id, array of rows per player)
  - sync-stats-gha.js and api/stats/sync/route.ts both write to history/2026.json
  - api/stats/route.ts bridges mlbam_id → Fantrax ID for players page compatibility
  - GHA commits history/2026.json instead of stats.json
  - Drawer career stats now reflect current season on same sync cycle as model
- **Two-way player support (Apr 2026):**
  - Full pipeline support: scoring, mlb-tools, stat sync, UI display all handle two-way players
  - scoreTool() filters history rows by type to prevent hitting/pitching cross-contamination
  - model_scores stores hit_overall, pitch_overall, blended overall (50/50) for two-way
  - mlb-tools.json: two-way players get type:'two-way' with all 5 tools + _pa + _ip
  - career_pitcher threshold changed to total career IP (not per-season) — catches McLean-type cases
  - Stat sync fetches both groups for two-way players; stats route serves _pit suffix key for pitching
  - Players page: two-way appears in both Bats and Arms filters; correct side overall shown per filter
  - PlayerRow: isPitcher() and isTwoWay() check all positions not just first
  - PlayerDrawer: BAT/ARM toggle for two-way players drives all content (career, splits, statcast, tools)
  - ARM_COLS: removed R and HR (not tracked in pitching history rows)

## Friend Teams (D52 League)
D52 = "DO MLB - D52" (id: d3prsagvmgftfdc3). Five named teams with assigned colors used for ownership dots, team buttons, and league page highlights:
- Jordan → Winston Salem Dash → `#22c55e` (green)
- Matt → Bay Area Bush League → `#a78bfa` (purple)
- Colin → Team Colin → `#38bdf8` (sky blue)
- Pat → Team Pat → `#fb923c` (orange)
- Soo → The Old Gold and Black → `#e879f9` (pink)

Jordan's green applies in ALL leagues (D28, D34, D52). Other friend colors only apply in D52.
⚠️ FRIEND_TEAMS color map is duplicated in: PlayerRow.tsx, app/players/page.tsx, app/hot-sheet/page.tsx, components/players/PlayerDrawer.tsx, app/leagues/[id]/page.tsx. Keep all in sync when adding/changing teams.
Ownership filter dropdown: All / Jordan / Matt / Colin / Pat / Soo / FA — all leagues / FA — any league.

## Stats Sync Architecture
⚠️ Two sync files must stay identical in level resolution logic AND two-way player handling:
- `scripts/sync-stats-gha.js` — used by GitHub Actions nightly
- `app/api/stats/sync/route.ts` — used by local Sync page

Both use SPORT_ID_TO_LEVEL + sportAbbrToLevel() with sportId fallback. Both fetch both groups for two-way players. If you update either file, update the other. Fallback chain: sport.id lookup → abbreviation lookup → sportId fallback → 'MiLB'.

## How We Work
- **Always start each session by dragging and dropping the full SCOUT_README.md file** — the full context is essential for model work
- **Always drag and drop full files** — never paste partial files or grep excerpts. Scout needs the full file to patch safely.
- Scout edits files directly via terminal commands — user pastes and runs them
- No zip files
- User comfortable with terminal basics but not a developer
- Temp/diagnostic scripts go in /tmp/ — Scout writes them there, user runs with `node /tmp/script.js` or `python3 /tmp/script.py`. Auto-clear on reboot. Never litter project root with throwaway scripts.
- Never rewrite entire files — surgical patches only
- Never hardcode years — use `new Date().getFullYear()` dynamically
- Before asserting anything about file contents, verify with grep or cat — never assume
- GHA conflict recovery — local is ALWAYS source of truth. Never merge. Force push after rebuilding:
  ```bash
  node scripts/build-norms.js && python3 scripts/build-regression.py && node scripts/build-scores.js
  git add -A && git commit -m "..." && git push --force
  ```
- Never use `git pull --rebase` — causes detached HEAD
- Never use `git merge` when GHA has pushed — always `git push --force` after rebuilding locally
