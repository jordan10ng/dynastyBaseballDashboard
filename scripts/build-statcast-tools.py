"""
build-statcast-tools.py
MLB Statcast tool grades — Phase 1, DISPLAY/DIAGNOSTIC ONLY. Nothing in dynasty_score /
model-rank / blend-rank reads this file. Statcast is MLB-only (plus spring/exhibition,
which is excluded here), so it is an outcome, never a MiLB-side predictor.

Regular season (game_type 'R') only. Each season's rate is z-scored against that season's
league norms (built from this same file, players clearing a per-season floor, sample-
weighted), then rolled to career weighted by each metric's own denominator. Same 100 + 15z
scale as build-mlb-tools.py.

Hitters:  power = mean z(barrel/BBE, hardhit/BBE, EV90, xISOcon)
          hit   = mean z(-whiff/swing, xBAcon, -chase)
          eye   = mean z(-chase, BB/PA)
          xwoba = z(xwOBA)                       — overall bat quality
          bat_speed = z(bat speed), 2023+ only   — null before
Pitchers: stuff   = mean z(whiff/swing, CSW, chase, primary-FB velo)
          control = mean z(strike%, zone%, -BB/PA)
          xwoba = z(-xwOBA against)              — overall run prevention
          No speed analog: file has no sprint speed.

_trunc = player has MLB history before 2015 (Statcast career is cut off at the front).
Output: data/model/statcast-tools.json
"""
import json, os, glob, math
from collections import defaultdict

BASE    = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS = os.path.join(BASE, 'players.json')
SC_PATH = os.path.join(BASE, 'statcast-totals.json')
HIST_DIR = os.path.join(BASE, 'history')
OUTPUT  = os.path.join(BASE, 'model', 'statcast-tools.json')

MIN_PA        = 100   # career floor to emit a grade (matches build-mlb-tools MIN_PA)
MIN_BF        = 100
NORM_MIN_PA   = 100   # per-season floor to enter league norms
NORM_MIN_BF   = 100
QUALIFIED_PA  = 300   # regression-grade sample (flag only)
QUALIFIED_BF  = 300
FB_TYPES      = ('FF', 'SI', 'FC')

with open(PLAYERS) as f: players = json.load(f)
with open(SC_PATH) as f: sc = json.load(f)

def to_plus(z): return round(100 + z * 15)

def ev_quantile(hist, q):
    items = sorted((int(k), v) for k, v in hist.items())
    total = sum(v for _, v in items)
    if total == 0: return None
    target, run = q * total, 0
    for ev, v in items:
        run += v
        if run >= target: return ev
    return items[-1][0]

# ── Per-season raw rates. Each metric = (value, weight) so career roll-up uses its own denom.
def hitter_season(b):
    bbe, sw = b['contact_count'], b['swings']
    out = {'_pa': b['pa_count'], '_bbe': bbe}
    if bbe > 0:
        out['barrel']  = (b['barrel_count'] / bbe, bbe)
        out['hardhit'] = (b['hardHit_count'] / bbe, bbe)
        ev90 = ev_quantile(b['evHistogram'], 0.9)
        if ev90 is not None: out['ev90'] = (ev90, bbe)
    if b['xba_n'] > 0 and b['xslg_n'] > 0:
        xba, xslg = b['sum_xba'] / b['xba_n'], b['sum_xslg'] / b['xslg_n']
        out['xbacon'] = (xba, b['xba_n'])
        out['xisocon'] = (xslg - xba, b['xslg_n'])
    if sw > 0: out['whiff'] = (b['whiffs'] / sw, sw)
    op = b.get('o_pitches', 0)
    if op > 0: out['chase'] = (b['o_swings'] / op, op)
    if b.get('strikes', 0) + b.get('balls', 0) > 0 and b['pa_count'] > 0:
        out['bb_pct'] = (b['bb_count'] / b['pa_count'], b['pa_count'])
    if b['xwoba_n'] > 0: out['xwoba'] = (b['sum_xwoba'] / b['xwoba_n'], b['xwoba_n'])
    if b['batSpeed_n'] > 0: out['bat_speed'] = (b['sum_batSpeed'] / b['batSpeed_n'], b['batSpeed_n'])
    return out

def pitcher_season(by_type):
    tot = defaultdict(float)
    for b in by_type.values():
        for k in ('count', 'swings', 'whiffs', 'pa_count', 'sum_xwoba', 'xwoba_n', 'strikes', 'balls',
                  'called_strikes', 'zone_count', 'o_pitches', 'o_swings', 'bb_count'):
            tot[k] += b.get(k, 0)
    out = {'_bf': tot['pa_count'], '_n': tot['count']}
    if tot['swings'] > 0: out['whiff'] = (tot['whiffs'] / tot['swings'], tot['swings'])
    # Newer reducer fields (strike/zone/chase/BB) -- absent in pre-2026-09 totals, so gate on strikes+balls.
    if tot['strikes'] + tot['balls'] > 0:
        out['strike']  = (tot['strikes'] / tot['count'], tot['count'])
        out['zone']    = (tot['zone_count'] / tot['count'], tot['count'])
        out['csw']     = ((tot['called_strikes'] + tot['whiffs']) / tot['count'], tot['count'])
        if tot['o_pitches'] > 0: out['chase'] = (tot['o_swings'] / tot['o_pitches'], tot['o_pitches'])
        if tot['pa_count'] > 0:  out['bb_pct'] = (tot['bb_count'] / tot['pa_count'], tot['pa_count'])
    if tot['xwoba_n'] > 0: out['xwoba'] = (tot['sum_xwoba'] / tot['xwoba_n'], tot['xwoba_n'])
    fbs = [(t, by_type[t]) for t in FB_TYPES if t in by_type and by_type[t]['velo_n'] > 0]
    if fbs:
        t, b = max(fbs, key=lambda x: x[1]['count'])
        out['fb_velo'] = (b['sum_velo'] / b['velo_n'], b['velo_n'])
        out['_fb_type'] = t
    return out

# ── Build per-season rows for everyone, then league norms per season.
hit_rows = defaultdict(dict)   # mlbam -> year -> season dict
pit_rows = defaultdict(dict)
for mid, p in sc.items():
    for y, g in (p.get('bat') or {}).items():
        r = g.get('R')
        if r and r['count'] > 0: hit_rows[mid][y] = hitter_season(r)
    for y, g in (p.get('pitch') or {}).items():
        r = g.get('R')
        if r: pit_rows[mid][y] = pitcher_season(r)

def build_norms(rows, floor_key, floor):
    acc = defaultdict(lambda: defaultdict(list))   # year -> metric -> [(val, w)]
    for seasons in rows.values():
        for y, s in seasons.items():
            if s[floor_key] < floor: continue
            for k, v in s.items():
                if k.startswith('_'): continue
                acc[y][k].append(v)
    norms = {}
    for y, metrics in acc.items():
        norms[y] = {}
        for k, pairs in metrics.items():
            W = sum(w for _, w in pairs)
            if len(pairs) < 20 or W == 0: continue
            mean = sum(v * w for v, w in pairs) / W
            var = sum(w * (v - mean) ** 2 for v, w in pairs) / W
            if var > 0: norms[y][k] = {'mean': mean, 'stdev': math.sqrt(var), 'n': len(pairs)}
    return norms

hit_norms = build_norms(hit_rows, '_pa', NORM_MIN_PA)
pit_norms = build_norms(pit_rows, '_bf', NORM_MIN_BF)

# Invert so higher z = better for the player.
HIT_INVERT = {'whiff', 'chase'}
PIT_INVERT = {'xwoba', 'bb_pct'}

def career_z(seasons, norms, invert):
    zs, ws, raw, rw = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
    for y, s in seasons.items():
        n = norms.get(y, {})
        for k, v in s.items():
            if k.startswith('_'): continue
            val, w = v
            raw[k] += val * w; rw[k] += w
            nk = n.get(k)
            if not nk: continue
            z = (val - nk['mean']) / nk['stdev']
            zs[k] += (-z if k in invert else z) * w
            ws[k] += w
    cz = {k: zs[k] / ws[k] for k in zs if ws[k] > 0}
    craw = {k: raw[k] / rw[k] for k in raw if rw[k] > 0}
    return cz, craw

def mean_plus(cz, keys):
    vals = [cz[k] for k in keys if k in cz]
    return to_plus(sum(vals) / len(vals)) if vals else None

def career_hitter(mid):
    seasons = hit_rows.get(mid)
    if not seasons: return None
    pa = sum(s['_pa'] for s in seasons.values())
    if pa < MIN_PA: return None
    cz, raw = career_z(seasons, hit_norms, HIT_INVERT)
    return {
        'power': mean_plus(cz, ('barrel', 'hardhit', 'ev90', 'xisocon')),
        'hit':   mean_plus(cz, ('whiff', 'xbacon', 'chase')),
        'eye':   mean_plus(cz, ('chase', 'bb_pct')),
        'xwoba': mean_plus(cz, ('xwoba',)),
        'bat_speed': mean_plus(cz, ('bat_speed',)),
        '_pa': round(pa), '_bbe': round(sum(s['_bbe'] for s in seasons.values())),
        '_seasons': len(seasons), '_first': int(min(seasons)),
        '_qualified': pa >= QUALIFIED_PA,
        '_z': {k: round(v, 3) for k, v in cz.items()},
        '_raw': {k: round(v, 4) for k, v in raw.items()},
    }

def career_pitcher(mid):
    seasons = pit_rows.get(mid)
    if not seasons: return None
    bf = sum(s['_bf'] for s in seasons.values())
    if bf < MIN_BF: return None
    cz, raw = career_z(seasons, pit_norms, PIT_INVERT)
    return {
        'stuff':   mean_plus(cz, ('whiff', 'csw', 'chase', 'fb_velo')),
        'control': mean_plus(cz, ('strike', 'zone', 'bb_pct')),
        'xwoba': mean_plus(cz, ('xwoba',)),
        '_bf': round(bf), '_pitches': round(sum(s['_n'] for s in seasons.values())),
        '_seasons': len(seasons), '_first': int(min(seasons)),
        '_qualified': bf >= QUALIFIED_BF,
        '_z': {k: round(v, 3) for k, v in cz.items()},
        '_raw': {k: round(v, 4) for k, v in raw.items()},
    }

# ── Pre-2015 MLB history → truncated-career flag.
pre2015 = set()
for path in glob.glob(os.path.join(HIST_DIR, '*.json')):
    fname = os.path.basename(path).replace('.json', '')
    if not fname.isdigit() or int(fname) >= 2015: continue
    with open(path) as f:
        for pid, ss in json.load(f).items():
            if any(s.get('level') == 'MLB' for s in ss): pre2015.add(str(pid))

def is_two_way(positions):
    pos = [x.strip() for x in (positions or '').split(',')]
    return any(x in ('SP', 'RP', 'P') for x in pos), any(x not in ('SP', 'RP', 'P') for x in pos)

output = {}
for p in players.values():
    mid = p.get('mlbam_id')
    if not mid: continue
    mid = str(mid)
    has_arm, has_bat = is_two_way(p.get('positions', ''))
    h = career_hitter(mid) if has_bat else None
    q = career_pitcher(mid) if has_arm else None
    if not h and not q: continue
    if h and q: result = {'type': 'two-way', 'bat': h, 'pitch': q}
    elif h:     result = {'type': 'hitter', **h}
    else:       result = {'type': 'pitcher', **q}
    result['name'] = p['name']
    result['_trunc'] = mid in pre2015
    output[mid] = result

def count(t, qual=False):
    return sum(1 for v in output.values() if v['type'] == t and (not qual or v.get('_qualified')))
print(f'Hitters:  {count("hitter")} ({count("hitter", True)} qualified ≥{QUALIFIED_PA} PA)')
print(f'Pitchers: {count("pitcher")} ({count("pitcher", True)} qualified ≥{QUALIFIED_BF} BF)')
print(f'Two-way:  {count("two-way")}')
print(f'Truncated (pre-2015 MLB): {sum(1 for v in output.values() if v["_trunc"])}')

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'Wrote {len(output)} → model/statcast-tools.json')
