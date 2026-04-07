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
- GitHub: https://github.com/jordan10ng/dynastyBaseballDashboard
- Push to deploy: `git add -A && git commit -m "..." && git push`
- Rankings and Sync pages hidden on deployed version via `NEXT_PUBLIC_SHOW_ADMIN` env var
- Set `NEXT_PUBLIC_SHOW_ADMIN=true` in `.env.local` to show them locally

## Directory Tree
fantasy-baseball/
├── app/
│   ├── page.tsx                          # Home/command center
│   ├── players/page.tsx                  # Main hub
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
│       ├── stats/route.ts, link/route.ts, sync/route.ts
│       ├── stats/history/[mlbamId]/route.ts  # Career history from local YYYY.json files
│       ├── model/tools/route.ts          # Serves mlb-tools.json to UI
│       ├── hot-sheet/route.ts            # Serves hot-sheet.json to UI
│       ├── leagues/route.ts, [id]/teams/route.ts, [id]/rosters/route.ts
│       └── fantrax/sync/route.ts, connect/route.ts
├── components/
│   ├── layout/Sidebar.tsx                # Desktop sidebar + mobile bottom tab bar
│   └── players/
│       ├── PlayerRow.tsx
│       ├── PlayerDrawer.tsx              # Full-screen player detail (Stats + Statcast tabs)
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
│   ├── build-norms.js                   # Level/league norms → data/model/norms.json
│   ├── build-mlb-scores.js              # MLB fantasy point rates → data/model/mlb-scores.json
│   ├── build-mlb-tools.py               # MLB career tool grades → data/model/mlb-tools.json
│   ├── build-age-elasticity.py          # Per-stat age elasticity → data/model/age-elasticity.json
│   ├── build-regression.py              # Blended level model → data/model/regression.json
│   └── build-scores.js                  # Scores prospects → players.json model_scores + hot-sheet.json
├── data/
│   ├── players.json                      # PERMANENT — never wipe. Has birthDate, mlbam_id, rank, model_scores.
│   ├── db.json                           # LIVE — safe to re-sync
│   ├── stats.json                        # LIVE — safe to re-sync (2026 current season)
│   ├── razzball.csv                      # ID bridge, update periodically
│   ├── rankings/
│   │   ├── sources/                      # Raw imported ranking sources (YYYYMMDD_name.json)
│   │   └── rankings.json                 # Computed consensus output
│   ├── history/
│   │   ├── progress.json                 # MLB pull resume tracker
│   │   ├── progress-milb.json            # MiLB pull resume tracker
│   │   └── YYYY.json                     # All player stat lines for that year (MLB + MiLB)
│   └── model/
│       ├── norms.json                    # Level/league/year stat norms (mean, stdev, n)
│       ├── mlb-scores.json               # Per-season MLB fantasy point rates (pts/PA, pts/IP)
│       ├── mlb-tools.json                # MLB career tool grades per player — graduation truth source
│       ├── age-elasticity.json           # Per-stat per-level age adjustment coefficients (reference only)
│       ├── regression.json               # Blended level model weights per tool
│       ├── hot-sheet.json                # Generated by build-scores.js — top 20 bats/arms by season delta
│       └── scores-snapshot.json          # Point-in-time snapshot of model overall + _sample per player

## Mobile
- Responsive layout for phone browsers (768px breakpoint)
- **Sidebar** — hidden on mobile, replaced with bottom tab bar (icons + labels)
- **Players page** — mobile renders slim list: RK · PLAYER (name/pos/team/level/stats) · OVR+. Paginated 75 at a time with Load More. Desktop full table unchanged.
- **Hot sheet** — mobile renders delta + stacked info (name · pos/team/level · stat line · tool line). Desktop grid unchanged.
- **Trade calculator** — stacks Team A / verdict / Team B vertically on mobile instead of side-by-side.
- **Player drawer** — already worked well on mobile, unchanged.

## Data Architecture
- **players.json** — ~10k players. id, name, team, positions, level, age, rank, mlbam_id, fangraphs_id, birthDate, model_scores. Never wipe. `rank` written by compute engine. `model_scores` written by build-scores.js.
- **db.json** — leagues, teams, rosters. Safe to delete + re-sync.
- **stats.json** — current season (2026) stats keyed by Fantrax ID. Always wiped on sync.
- **rankings/sources/** — one JSON per imported ranking source. Never auto-deleted.
- **rankings/rankings.json** — computed consensus output. Rewritten on each compute.
- **history/YYYY.json** — all player stat lines for that year keyed by mlbam_id. Contains both MLB and MiLB lines. 2026.json updated by stats sync, not history scripts.
- **model/norms.json** — level+league+year stat norms. Primary key: `"AA|2023"`. Rebuild by running `build-norms.js`.
- **model/mlb-scores.json** — per-season MLB fantasy point rates. Rebuild by running `build-mlb-scores.js`.
- **model/mlb-tools.json** — per-player career MLB tool grades keyed by mlbam_id. **Source of truth for MLB vs minors designation** — presence = graduated. Rebuild by running `build-mlb-tools.py`.
- **model/age-elasticity.json** — kept for reference, no longer used in scoring.
- **model/regression.json** — per-tool blended level model. Rebuild by running `build-regression.py`.
- **model/hot-sheet.json** — top 20 bats + 20 arms by current season model delta. Written by build-scores.js every run.
- **model/scores-snapshot.json** — snapshot of model scores keyed by Fantrax ID. Written as comparison baseline.

## Fantrax Integration
- League IDs: `0ehfuam0mg7wqpn7` (D28), `ew7b8seomg7u7uzi` (D34), `d3prsagvmgftfdc3` (D52)
- Cookie expires — re-grab from Chrome DevTools → Network → any fantrax.com request → `cookie:` header → paste into .env.local as `FANTRAX_COOKIE=...`

## Stats Integration (MLB Stats API — free, no key)
### 4-step sync (Sync page — admin only):
1. Import Player Database — Fantrax CSV → players.json (one-time)
2. Sync Leagues — Fantrax API → db.json
3. Link Player IDs — razzball.csv + MLB API name fallback → mlbam_id on players.json (~92% coverage)
4. Sync Stats — MLB API season stats → stats.json (~52s). `CURRENT_SEASON = 2026` in api/stats/sync/route.ts

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
- Arms columns: G · W-L · IP · BAA · ERA · WHIP · H · R · ER · HR · BB · SO · K% · BB% · K-BB%
- Freeze panes: #/RK/POS/PLAYER sticky left (POS dropped in All mode); header syncs horizontally with rows
- Mobile: slim 2-col layout, paginated 75 at a time

## Player Drawer (full screen)
Click any player → full screen overlay. Escape or ✕ to close.

### Two tabs: Stats · Statcast

### Stats tab:
- Bio strip: B/T · HT/WT · Born · Debut · Draft
- Stat tiles: ERA + K-BB% (arms) or K% + BB% (bats)
- Career table: yearByYear MLB + MiLB. MiLB rows indigo tint. Collapsible multi-team seasons.
- Tool tiles: per-tool show value · ▲raw (ceiling) · conf%

### Statcast tab:
- Hitters: EV tiles, expected stats, batted ball, plate discipline, spray chart, vs pitch type
- Pitchers: EV against, pitch movement chart, pitch mix table, plate discipline
- ⚠️ Pitcher chart incomplete — movement plot only, no release point scatter (see Next Priorities)

## Ranking System
- **O** (Overall), **P** (Prospect), **X** (Open Universe/tier) source types
- Weighted consensus engine with staleness decay (100% at day 0 → 0% at day 365)
- Writes rankings.json and patches rank field in players.json

## Proprietary Ranking Model (`data/model/`)

**Tools:** Hit+ (k%+bb%), Power+ (iso), Speed+ (sb_rate) for hitters. Stuff+ (k%), Control+ (bb%) for pitchers. All 100 = MLB average.

**Pipeline:**
1. `build-norms.js` → norms.json
2. `build-mlb-tools.py` → mlb-tools.json (training targets)
3. `build-regression.py` → regression.json
4. `build-scores.js` → model_scores on players.json + hot-sheet.json

**Age boost:** `pred_adjusted = 100 + (pred - 100) × exp(C × ageDiff)`, C=0.15 hitters / C=0.10 pitchers. Speed exempt. Applied post-regression, pre-blend.

**Per-tool shrinkage** individually; overall = pure weighted blend. _raw = pre-shrinkage ceiling.

**Hot sheet:** Risers = players with prior history whose overall(with CY) - overall(without CY) ≥ 1. No sample thresholds — shrinkage handles noise. Sorted by delta desc, then overall.

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
5. **mlb tools weighted average with minor tools** so guys like basallo keep their tools
6. **emerging** best new raw tools with X confidence

## Known Issues
- ~13% of rostered players not in players.json (post-export prospects)
- Fantrax cookie expires, manual refresh needed
- Trade calculator not connected to model scores
- oObp/oSlg only for single-team pitching seasons
- Statcast pitcher chart incomplete (movement only, no release point scatter)
- ~20 remaining mlbam_id duplicate pairs — benign
- ⚠️ `build-age-elasticity.py` and `build-mlb-scores.js` NOT in auto-run pipeline — run manually
- ⚠️ Sync Stats timeout is 5 min per model step — bump `timeout` in api/stats/sync/route.ts if needed
- Hot sheet early season produces mostly +1 deltas — correct behavior, weights handle small samples

## Fixed (Apr 2026)
- sportId=21 phantom entries excluded — 17,663 rows scrubbed
- DSL mislabeled as Complex — fixed by splitting on league name
- Pitcher regression zero coefficients — k/bb_allowed field name mismatch fixed
- Age weighting rebuilt — prediction-level boost replaces multiplicative z-score adjustment
- M badge now uses mlb-tools.json presence check
- build-scores.js overall fixed (was double-normalized)
- Recency decay (0.75/year) + 3-year recency requirement added
- Per-tool shrinkage + _raw ceiling field added
- Hot sheet rebuilt — risers (ex-CY delta ≥ 1) replaces old integer-delta approach; emerging dropped
- Hot sheet: G/IP added to stat line; mobile tool colors per-tool; pos/team/level on name line
- Mine+FA filter added
- All mode stat blurb added to players page
- Players page: RK column clickable sort; Sort button removed; All mode folds pos/team/level into name line, drops POS column
- Players page mobile: pos/team/level + dots on name line
- Career stats from local history files (no external API call)
- Drawer tool tiles with ceiling + confidence
- **Mobile layout** — bottom tab nav, mobile players/hot-sheet/trade, pagination
- **Deployed to Vercel** — https://dynasty-baseball-dashboard.vercel.app/
- **Admin pages hidden on deploy** via NEXT_PUBLIC_SHOW_ADMIN env var

## How We Work
- Scout has direct read/write access to ~/Desktop/fantasy-baseball via mounted folder
- Scout edits files directly — user runs terminal commands for Node/Python scripts
- No zip files, no drag and drop
- User comfortable with terminal basics but not a developer
- All file patches via node /tmp/patch.js scripts written to file first
- Never rewrite entire files — surgical patches only
