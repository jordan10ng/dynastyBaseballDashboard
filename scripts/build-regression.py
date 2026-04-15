"""
build-regression.py
Two-feature regression: pred = slope_z * z + slope_age * age_diff + intercept
Output: data/model/regression.json
"""
import json, os, glob
from collections import defaultdict
import numpy as np
from datetime import datetime

BASE         = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS_PATH = os.path.join(BASE, 'players.json')
NORMS_PATH   = os.path.join(BASE, 'model', 'norms.json')
TOOLS_PATH   = os.path.join(BASE, 'model', 'mlb-tools.json')
REGR_PATH    = os.path.join(BASE, 'model', 'regression.json')

with open(PLAYERS_PATH) as f: players   = json.load(f)
with open(NORMS_PATH)   as f: norms     = json.load(f)
with open(TOOLS_PATH)   as f: mlb_tools = json.load(f)

VALID_YEARS  = {2015,2016,2017,2018,2019,2021,2022,2023,2024,2025}
AVG_AGES     = {'AAA':26.4,'AA':24.0,'High-A':22.6,'Single-A':21.3,
                'Complex':19.9,'DSL':17.9,'Rookie':20.4}
MILB_LEVELS  = set(AVG_AGES.keys())
LEVELS_ORDER = ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA']
SPEED_STATS  = {'sb_rate'}

TOOL_STATS = {
    'hit':     ('hitter',  ['k_pct','bb_pct']),
    'power':   ('hitter',  ['iso']),
    'speed':   ('hitter',  ['sb_rate']),
    'stuff':   ('pitcher', ['k_pct']),
    'control': ('pitcher', ['bb_pct']),
}

mlbam_to_player = {str(p['mlbam_id']): p for p in players.values() if p.get('mlbam_id')}

history = defaultdict(list)
for path in sorted(glob.glob(os.path.join(BASE, 'history', '*.json'))):
    fname = os.path.basename(path).replace('.json','')
    if not fname.isdigit(): continue
    year = int(fname)
    if year not in VALID_YEARS: continue
    with open(path) as f:
        for pid, seasons in json.load(f).items():
            for s in seasons:
                history[pid].append({**s, 'year': year})

def ip_to_float(ip):
    try:
        parts = str(ip).split('.')
        return int(parts[0]) + (int(parts[1]) if len(parts) > 1 else 0) / 3
    except: return 0.0

def get_age(dob, year):
    if not dob: return None
    try:
        d = datetime.strptime(dob, '%Y-%m-%d')
        age = year - d.year
        if d.month > 7 or (d.month == 7 and d.day > 1): age -= 1
        return age
    except: return None

obs = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))

for mlbam, tools in mlb_tools.items():
    player = mlbam_to_player.get(str(mlbam))
    if not player: continue
    is_p = tools['type'] == 'pitcher'

    seasons = history.get(str(mlbam), [])
    milb = [s for s in seasons if s.get('level') in MILB_LEVELS
            and s['year'] in VALID_YEARS and s.get('team')]
    if not milb: continue

    for s in milb:
        year   = s['year']
        level  = s['level']
        sample = ip_to_float(s.get('ip',0)) if is_p else (s.get('pa') or 0)
        if sample < (15 if is_p else 30): continue

        n = norms.get(f"{level}|{year}", {}).get('pitchers' if is_p else 'hitters', {})
        if not n: continue

        age      = get_age(player.get('birthDate'), year) or AVG_AGES[level]
        age_diff = AVG_AGES[level] - age

        raw = {}
        if not is_p:
            pa = sample
            raw['k_pct']   = (s.get('so') or 0) / pa
            raw['bb_pct']  = (s.get('bb') or 0) / pa
            raw['iso']     = float(s.get('slg') or 0) - float(s.get('avg') or 0)
            tob = (s.get('h') or 0) + (s.get('bb') or 0) + (s.get('hbp') or 0)
            raw['sb_rate'] = (s.get('sb') or 0) / tob if tob > 0 else 0
        else:
            bf = s.get('bf') or 0
            raw['k_pct']  = (s.get('so') or 0) / bf if bf > 0 else None
            raw['bb_pct'] = (s.get('bb') or 0) / bf if bf > 0 else None

        for tool, (ptype, stats) in TOOL_STATS.items():
            if (is_p and ptype != 'pitcher') or (not is_p and ptype != 'hitter'): continue
            outcome = tools.get(tool)
            if outcome is None: continue

            for stat in stats:
                v = raw.get(stat)
                if v is None: continue
                sn = n.get(stat)
                if not sn or sn['stdev'] == 0: continue

                z = (v - sn['mean']) / sn['stdev']
                if (not is_p and stat == 'k_pct') or (is_p and stat == 'bb_pct'):
                    z = -z

                obs[tool][level][stat].append((z, age_diff, outcome, sample))

MIN_N = 20
level_models = {}

print('='*75)
print('  FITTED MODELS PER TOOL x LEVEL x STAT  (slope_z, slope_age, intercept)')
print('='*75)

for tool, (ptype, stats) in TOOL_STATS.items():
    level_models[tool] = {}
    print(f'\n{"─"*75}')
    print(f'  {tool.upper()}+  ({ptype})')
    print(f'{"─"*75}')
    print(f'  {"level":<12} {"stat":<10} {"corr":>7} {"slope_z":>9} {"slope_age":>10} {"intercept":>10} {"n":>6}')
    print(f'  {"-"*62}')

    for level in LEVELS_ORDER:
        level_models[tool][level] = {}
        for stat in stats:
            pairs = obs[tool][level][stat]
            n = len(pairs)
            if n < MIN_N:
                print(f'  {level:<12} {stat:<10} {"--":>7} {"--":>9} {"--":>10} {"--":>10} {n:>6}  (insufficient)')
                continue

            zs       = np.array([p[0] for p in pairs])
            ages     = np.array([p[1] for p in pairs])
            outcomes = np.array([p[2] for p in pairs])

            corr = float(np.corrcoef(zs, outcomes)[0,1])

            if stat in SPEED_STATS:
                X = np.column_stack([zs, np.ones(n)])
                coef, _, _, _ = np.linalg.lstsq(X, outcomes, rcond=None)
                slope_z, slope_age, intercept = float(coef[0]), 0.0, float(coef[1])
            else:
                X = np.column_stack([zs, ages, np.ones(n)])
                coef, _, _, _ = np.linalg.lstsq(X, outcomes, rcond=None)
                slope_z, slope_age, intercept = float(coef[0]), float(coef[1]), float(coef[2])

            level_models[tool][level][stat] = {
                'slope_z':   round(slope_z, 4),
                'slope_age': round(slope_age, 4),
                'intercept': round(intercept, 4),
                'corr':      round(corr, 4),
                'n':         n,
            }
            print(f'  {level:<12} {stat:<10} {corr:>7.3f} {slope_z:>9.3f} {slope_age:>10.3f} {intercept:>10.3f} {n:>6}')

print(f'\n{"="*75}')
print('  VALIDATION: R² on training set per tool')
print('='*75)

def score_player_tool(mlbam, is_p, tool, player):
    stats_for_tool = TOOL_STATS[tool][1]
    seasons = history.get(str(mlbam), [])
    milb = [s for s in seasons if s.get('level') in MILB_LEVELS
            and s['year'] in VALID_YEARS and s.get('team')]
    if not milb: return None

    weighted_sum = 0.0
    total_weight = 0.0

    for s in milb:
        year   = s['year']
        level  = s['level']
        sample = ip_to_float(s.get('ip',0)) if is_p else (s.get('pa') or 0)
        if sample < (15 if is_p else 30): continue

        n = norms.get(f"{level}|{year}", {}).get('pitchers' if is_p else 'hitters', {})
        if not n: continue

        age      = get_age(player.get('birthDate'), year) or AVG_AGES[level]
        age_diff = AVG_AGES[level] - age

        raw = {}
        if not is_p:
            pa = sample
            raw['k_pct']   = (s.get('so') or 0) / pa
            raw['bb_pct']  = (s.get('bb') or 0) / pa
            raw['iso']     = float(s.get('slg') or 0) - float(s.get('avg') or 0)
            tob = (s.get('h') or 0) + (s.get('bb') or 0) + (s.get('hbp') or 0)
            raw['sb_rate'] = (s.get('sb') or 0) / tob if tob > 0 else 0
        else:
            bf = s.get('bf') or 0
            raw['k_pct']  = (s.get('so') or 0) / bf if bf > 0 else None
            raw['bb_pct'] = (s.get('bb') or 0) / bf if bf > 0 else None

        for stat in stats_for_tool:
            model = level_models[tool].get(level, {}).get(stat)
            if not model: continue
            v = raw.get(stat)
            if v is None: continue
            sn = n.get(stat)
            if not sn or sn['stdev'] == 0: continue

            z = (v - sn['mean']) / sn['stdev']
            if (not is_p and stat == 'k_pct') or (is_p and stat == 'bb_pct'):
                z = -z

            slope_age = model.get('slope_age', 0.0)
            predicted = model['slope_z'] * z + slope_age * age_diff + model['intercept']
            weight    = model['corr'] * sample

            weighted_sum += predicted * weight
            total_weight += weight

    if total_weight == 0: return None
    return weighted_sum / total_weight

for tool, (ptype, stats) in TOOL_STATS.items():
    is_p = ptype == 'pitcher'
    preds, actuals = [], []
    for mlbam, tools in mlb_tools.items():
        if tools['type'] != ptype: continue
        player = mlbam_to_player.get(str(mlbam))
        if not player: continue
        actual = tools.get(tool)
        if actual is None: continue
        pred = score_player_tool(mlbam, is_p, tool, player)
        if pred is None: continue
        preds.append(pred)
        actuals.append(actual)

    if not preds:
        print(f'  {tool.upper()}+: no predictions')
        continue

    preds   = np.array(preds)
    actuals = np.array(actuals)
    ss_res  = np.sum((actuals - preds) ** 2)
    ss_tot  = np.sum((actuals - actuals.mean()) ** 2)
    r2      = 1 - ss_res / ss_tot
    corr    = np.corrcoef(preds, actuals)[0,1]
    print(f'  {tool.upper()}+:  R²={r2:.3f}  corr={corr:.3f}  n={len(preds)}')

output = {'tools': {t: {'type': v[0], 'stats': v[1]} for t, v in TOOL_STATS.items()},
          'models': level_models}

with open(REGR_PATH, 'w') as f: json.dump(output, f, indent=2)
print(f'\nWrote regression.json')
