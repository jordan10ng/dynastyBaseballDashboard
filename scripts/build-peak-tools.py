"""
build-peak-tools.py
Best rolling 3-year MLB window per tool (ceiling, not career average) — training
targets for the peak regression. Same z-scoring/weighting as build-mlb-tools.py,
just maximized over 3-year windows instead of rolled across the whole career.
Also computes the debut-gated "worthy career" binary flag used by
build-worthy-calibration.py (needs >=4 full years since MLB debut to judge fairly —
recent debuts haven't had time to accumulate a career yet).
Output: data/model/peak-tools.json
"""
import json, os, glob
from collections import defaultdict
from datetime import datetime

BASE       = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS    = os.path.join(BASE, 'players.json')
HIST_DIR   = os.path.join(BASE, 'history')
NORMS_PATH = os.path.join(BASE, 'model', 'norms.json')
TOOLS_PATH = os.path.join(BASE, 'model', 'mlb-tools.json')
OUTPUT     = os.path.join(BASE, 'model', 'peak-tools.json')

MIN_SEASONS  = 1
MIN_PA       = 100
MIN_IP       = 50.0
WINDOW       = 3
DEBUT_GATE   = 4      # years since debut required to fairly judge "worthy career"
WORTHY_PA    = 1500   # career PA threshold, hitters
WORTHY_IP    = 300.0  # career IP threshold, pitchers
CURRENT_YEAR = datetime.now().year

with open(PLAYERS) as f: players = json.load(f)
with open(NORMS_PATH) as f: norms = json.load(f)
with open(TOOLS_PATH) as f: mlb_tools = json.load(f)

history = defaultdict(list)
for path in sorted(glob.glob(os.path.join(HIST_DIR, '*.json'))):
    fname = os.path.basename(path).replace('.json','')
    if not fname.isdigit(): continue
    year = int(fname)
    with open(path) as f:
        for pid, seasons in json.load(f).items():
            for s in seasons:
                history[pid].append({**s, 'year': year})

VALID_YEARS = {2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026}

def ip_to_float(ip):
    try:
        parts = str(ip).split('.')
        full = int(parts[0])
        thirds = int(parts[1]) if len(parts) > 1 else 0
        return full + thirds / 3
    except: return 0.0

def zscore(val, norm_entry, stat, invert=False):
    if norm_entry is None: return None
    s = norm_entry.get(stat)
    if not s or s['stdev'] == 0: return None
    z = (val - s['mean']) / s['stdev']
    return -z if invert else z

def to_plus(z): return 100 + z * 15

# ── per-season z components, same formulas as build-mlb-tools.py's career rollup ──
def hitter_season_z(s):
    pa = s.get('pa') or 0
    if pa < MIN_PA: return None
    ab, h, bb, so, hbp, sb = s.get('ab') or 0, s.get('h') or 0, s.get('bb') or 0, s.get('so') or 0, s.get('hbp') or 0, s.get('sb') or 0
    slg = float(s.get('slg') or 0)
    avg = h / ab if ab > 0 else 0
    iso = slg - avg
    k_pct, bb_pct = so / pa, bb / pa
    doubles, triples, hr = s.get('doubles') or 0, s.get('triples') or 0, s.get('hr') or 0
    singles = h - doubles - triples - hr
    steal_opps = singles + bb + hbp
    sb_rate = sb / steal_opps if steal_opps > 0 else 0
    n = norms.get(f"MLB|{s['year']}", {}).get('hitters')
    z = {
        'avg':     zscore(avg, n, 'avg'),
        'k_pct':   zscore(k_pct, n, 'k_pct', invert=True),
        'bb_pct':  zscore(bb_pct, n, 'bb_pct'),
        'iso':     zscore(iso, n, 'iso'),
        'sb_rate': zscore(sb_rate, n, 'sb_rate'),
    }
    return z, pa

def pitcher_season_z(s):
    bf = s.get('bf') or 0
    if bf == 0: return None
    ip = ip_to_float(s.get('ip', 0))
    k_pct, bb_pct = (s.get('so') or 0) / bf, (s.get('bb') or 0) / bf
    n = norms.get(f"MLB|{s['year']}", {}).get('pitchers')
    z = {
        'k_pct':  zscore(k_pct, n, 'k_pct'),
        'bb_pct': zscore(bb_pct, n, 'bb_pct', invert=True),
    }
    return z, ip

HIT_TOOLS = {
    'hit':   lambda z: (to_plus(z.get('avg') or 0) + to_plus(z.get('k_pct') or 0) + to_plus(z.get('bb_pct') or 0)) / 3,
    'power': lambda z: to_plus(z.get('iso') or 0),
    'speed': lambda z: to_plus(z.get('sb_rate') or 0),
}
PITCH_TOOLS = {
    'stuff':   lambda z: to_plus(z.get('k_pct') or 0),
    'control': lambda z: to_plus(z.get('bb_pct') or 0),
}

def best_window(per_season, tool_fn):
    """per_season: list of (year, z_dict, weight). Returns (best_value, [y0,y1]) or (None, None)."""
    if not per_season: return None, None
    best_val, best_window_years = None, None
    for i in range(len(per_season)):
        y0 = per_season[i][0]
        chunk = [p for p in per_season if y0 <= p[0] < y0 + WINDOW]
        zsum, wsum = defaultdict(float), 0.0
        for _, z, w in chunk:
            for k, v in z.items():
                if v is not None: zsum[k] += v * w
            wsum += w
        if wsum <= 0: continue
        cz = {k: v / wsum for k, v in zsum.items()}
        val = tool_fn(cz)
        if best_val is None or val > best_val:
            best_val, best_window_years = val, [y0, max(p[0] for p in chunk)]
    return best_val, best_window_years

def peak_hitter(pid):
    all_mlb = [s for s in history.get(str(pid), []) if s.get('level') == 'MLB' and s.get('type') == 'hitting' and s['year'] in VALID_YEARS]
    if not all_mlb: return None
    debut = min(s['year'] for s in all_mlb)
    career_pa = sum(s.get('pa') or 0 for s in all_mlb)

    qualifying = sorted([s for s in all_mlb if (s.get('pa') or 0) >= MIN_PA], key=lambda s: s['year'])
    if len(qualifying) < MIN_SEASONS: return None
    per_season = []
    for s in qualifying:
        r = hitter_season_z(s)
        if r is None: continue
        z, pa = r
        per_season.append((s['year'], z, pa))
    if not per_season: return None

    result = {'type': 'hitter', '_seasons': len(qualifying), '_debut': debut, '_career_pa': round(career_pa)}
    for tool, fn in HIT_TOOLS.items():
        val, window = best_window(per_season, fn)
        result[tool] = round(val) if val is not None else None
        result[f'_{tool}_window'] = window
    return result

def peak_pitcher(pid):
    all_mlb = [s for s in history.get(str(pid), []) if s.get('level') == 'MLB' and s.get('type') == 'pitching' and s['year'] in VALID_YEARS]
    if not all_mlb: return None
    debut = min(s['year'] for s in all_mlb)
    career_ip = sum(ip_to_float(s.get('ip', 0)) for s in all_mlb)
    if career_ip < MIN_IP: return None

    per_season = []
    for s in sorted(all_mlb, key=lambda s: s['year']):
        r = pitcher_season_z(s)
        if r is None: continue
        z, ip = r
        per_season.append((s['year'], z, ip))
    if not per_season: return None

    result = {'type': 'pitcher', '_seasons': len(all_mlb), '_debut': debut, '_career_ip': round(career_ip)}
    for tool, fn in PITCH_TOOLS.items():
        val, window = best_window(per_season, fn)
        result[tool] = round(val) if val is not None else None
        result[f'_{tool}_window'] = window
    return result

def worthy_flag(mlbam, ptype, debut, sample):
    """Debut-gated binary: did this player accumulate a real MLB career AND perform
    at or above average once they got there? None if too new to judge fairly."""
    if (CURRENT_YEAR - debut) < DEBUT_GATE: return None
    tools = mlb_tools.get(str(mlbam))
    if not tools: return 0
    if ptype == 'pitcher':
        actual = tools.get('stuff', 0) * 0.70 + tools.get('control', 0) * 0.30
        return 1 if (sample >= WORTHY_IP and actual >= 100) else 0
    else:
        actual = tools.get('hit', 0) * 0.42 + tools.get('power', 0) * 0.47 + tools.get('speed', 0) * 0.11
        return 1 if (sample >= WORTHY_PA and actual >= 100) else 0

def is_two_way(positions):
    pos = [x.strip() for x in (positions or '').split(',')]
    has_arm = any(x in ('SP','RP','P') for x in pos)
    has_bat = any(x not in ('SP','RP','P') for x in pos)
    return has_arm, has_bat

output = {}
skipped = 0

for pid, p in players.items():
    mlbam = p.get('mlbam_id')
    if not mlbam: continue
    has_arm, has_bat = is_two_way(p.get('positions',''))

    if has_arm and has_bat:
        hit_result   = peak_hitter(mlbam)
        pitch_result = peak_pitcher(mlbam)
        if not hit_result and not pitch_result:
            skipped += 1; continue
        result = {'type': 'two-way', 'name': p['name']}
        if hit_result:
            for k in ('hit','power','speed','_hit_window','_power_window','_speed_window','_seasons','_debut','_career_pa'):
                result[k if k not in ('_seasons',) else '_seasons_hit'] = hit_result[k]
            result['_worthy'] = worthy_flag(mlbam, 'hitter', hit_result['_debut'], hit_result['_career_pa'])
        if pitch_result:
            for k in ('stuff','control','_stuff_window','_control_window','_seasons','_debut','_career_ip'):
                result[k if k not in ('_seasons',) else '_seasons_pitch'] = pitch_result[k]
            result['_worthy_pitch'] = worthy_flag(mlbam, 'pitcher', pitch_result['_debut'], pitch_result['_career_ip'])
    elif has_arm:
        result = peak_pitcher(mlbam)
        if not result: skipped += 1; continue
        result['name'] = p['name']
        result['_worthy'] = worthy_flag(mlbam, 'pitcher', result['_debut'], result['_career_ip'])
    else:
        result = peak_hitter(mlbam)
        if not result: skipped += 1; continue
        result['name'] = p['name']
        result['_worthy'] = worthy_flag(mlbam, 'hitter', result['_debut'], result['_career_pa'])

    output[str(mlbam)] = result

print(f'Qualifying hitters:  {sum(1 for v in output.values() if v["type"]=="hitter")}')
print(f'Qualifying pitchers: {sum(1 for v in output.values() if v["type"]=="pitcher")}')
print(f'Two-way:             {sum(1 for v in output.values() if v["type"]=="two-way")}')
print(f'Skipped (insufficient): {skipped}')
eligible = sum(1 for v in output.values() if v.get('_worthy') is not None)
worthy   = sum(1 for v in output.values() if v.get('_worthy') == 1)
print(f'Debut-gated eligible: {eligible}  (worthy: {worthy})')

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'Wrote {len(output)} peak grades → model/peak-tools.json')
