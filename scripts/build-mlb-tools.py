"""
build-mlb-tools.py
Computes MLB career tool grades — training targets for the prospect regression.
Each season z-scored against MLB|YYYY norms, weighted by PA/IP, rolled to career.
Output: data/model/mlb-tools.json
"""
import json, os, glob, math
from collections import defaultdict

BASE       = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS    = os.path.join(BASE, 'players.json')
HIST_DIR   = os.path.join(BASE, 'history')
NORMS_PATH = os.path.join(BASE, 'model', 'norms.json')
OUTPUT     = os.path.join(BASE, 'model', 'mlb-tools.json')

MIN_SEASONS = 1
MIN_PA      = 100
MIN_IP      = 50.0
MIN_GS      = 5

with open(PLAYERS) as f: players = json.load(f)
with open(NORMS_PATH) as f: norms = json.load(f)

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

def career_hitter(pid):
    mlb = [s for s in history.get(str(pid), [])
           if s.get('level') == 'MLB' and s.get('type') == 'hitting'
           and s['year'] in VALID_YEARS and (s.get('pa') or 0) >= MIN_PA]
    if len(mlb) < MIN_SEASONS: return None

    stat_sums = defaultdict(float)
    total_pa  = 0.0

    for s in mlb:
        pa   = s['pa']
        ab   = s.get('ab') or 0
        h    = s.get('h') or 0
        bb   = s.get('bb') or 0
        so   = s.get('so') or 0
        slg  = float(s.get('slg') or 0)
        hbp  = s.get('hbp') or 0
        sb   = s.get('sb') or 0

        avg  = h / ab if ab > 0 else 0
        iso  = slg - avg
        k_pct  = so / pa
        bb_pct = bb / pa
        tob    = h + bb + hbp
        sb_rate = sb / tob if tob > 0 else 0

        n = norms.get(f"MLB|{s['year']}", {}).get('hitters')

        z_avg    = zscore(avg,     n, 'avg')
        z_k      = zscore(k_pct,  n, 'k_pct',  invert=True)
        z_bb     = zscore(bb_pct, n, 'bb_pct')
        z_iso    = zscore(iso,    n, 'iso')
        z_sb     = zscore(sb_rate,n, 'sb_rate')

        for key, z in [('avg',z_avg),('k_pct',z_k),('bb_pct',z_bb),('iso',z_iso),('sb_rate',z_sb)]:
            if z is not None:
                stat_sums[key] += z * pa

        total_pa += pa

    if total_pa == 0: return None

    career_z = {k: v / total_pa for k, v in stat_sums.items()}

    def to_plus(z): return round(100 + z * 15)

    hit   = round((to_plus(career_z.get('avg',0)) +
                   to_plus(career_z.get('k_pct',0)) +
                   to_plus(career_z.get('bb_pct',0))) / 3)
    power = to_plus(career_z.get('iso', 0))
    speed = to_plus(career_z.get('sb_rate', 0))

    return {
        'type': 'hitter',
        'hit': hit, 'power': power, 'speed': speed,
        '_seasons': len(mlb), '_pa': round(total_pa),
        '_z': {k: round(v,3) for k,v in career_z.items()},
    }

def career_pitcher(pid):
    mlb = [s for s in history.get(str(pid), [])
           if s.get('level') == 'MLB' and s.get('type') == 'pitching'
           and s['year'] in VALID_YEARS
           and ip_to_float(s.get('ip',0)) >= MIN_IP
           and (s.get('gs') or 0) >= MIN_GS]
    if len(mlb) < MIN_SEASONS: return None

    stat_sums = defaultdict(float)
    total_ip  = 0.0

    for s in mlb:
        ip  = ip_to_float(s.get('ip', 0))
        bf  = s.get('bf') or 0
        so  = s.get('so') or 0
        bb  = s.get('bb') or 0

        if bf == 0: continue

        k_pct  = so / bf
        bb_pct = bb / bf

        n = norms.get(f"MLB|{s['year']}", {}).get('pitchers')

        z_k  = zscore(k_pct,  n, 'k_pct')
        z_bb = zscore(bb_pct, n, 'bb_pct', invert=True)

        for key, z in [('k_pct', z_k), ('bb_pct', z_bb)]:
            if z is not None:
                stat_sums[key] += z * ip

        total_ip += ip

    if total_ip == 0: return None

    career_z = {k: v / total_ip for k, v in stat_sums.items()}

    def to_plus(z): return round(100 + z * 15)

    stuff   = to_plus(career_z.get('k_pct', 0))
    control = to_plus(career_z.get('bb_pct', 0))

    return {
        'type': 'pitcher',
        'stuff': stuff, 'control': control,
        '_seasons': len(mlb), '_ip': round(total_ip),
        '_z': {k: round(v,3) for k,v in career_z.items()},
    }

output = {}
skipped = 0

for pid, p in players.items():
    mlbam = p.get('mlbam_id')
    if not mlbam: continue
    is_p = 'P' in (p.get('positions') or '')
    result = career_pitcher(mlbam) if is_p else career_hitter(mlbam)
    if not result:
        skipped += 1
        continue
    result['name'] = p['name']
    output[str(mlbam)] = result

print(f'Qualifying hitters:  {sum(1 for v in output.values() if v["type"]=="hitter")}')
print(f'Qualifying pitchers: {sum(1 for v in output.values() if v["type"]=="pitcher")}')
print(f'Skipped (insufficient): {skipped}')

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'Wrote {len(output)} tool grades → model/mlb-tools.json')
