"""
build-age-elasticity.py
Derives per-stat per-level age elasticity coefficients from historical data.
Replaces hardcoded exp(0.15 * age_diff) with empirically derived per-stat k values
that plug into exp(k * age_diff) in the regression feature builder.
Output: data/model/age-elasticity.json
"""
import json, os, glob, math
from collections import defaultdict
import numpy as np

BASE        = os.path.expanduser('~/Desktop/fantasy-baseball/data')
PLAYERS     = os.path.join(BASE, 'players.json')
HIST_DIR    = os.path.join(BASE, 'history')
TOOLS_PATH  = os.path.join(BASE, 'model', 'mlb-tools.json')
NORMS_PATH  = os.path.join(BASE, 'model', 'norms.json')
OUTPUT      = os.path.join(BASE, 'model', 'age-elasticity.json')

with open(PLAYERS)    as f: players   = json.load(f)
with open(TOOLS_PATH) as f: mlb_tools = json.load(f)
with open(NORMS_PATH) as f: norms     = json.load(f)

VALID_YEARS = {2015,2016,2017,2018,2019,2021,2022,2023,2024,2025}
AVG_AGES    = {'AAA':26.5,'AA':24.5,'High-A':23.0,'Single-A':21.5,'Complex':19.5,'DSL':17.5,'Rookie':20.0}
MILB_LEVELS = set(AVG_AGES.keys())

HITTER_STATS  = ['k_pct','bb_pct','iso','avg','sb_rate']
PITCHER_STATS = ['k_pct','bb_pct','baa']

# ── Load history ──────────────────────────────────────────────────────────────
history = defaultdict(list)
for path in sorted(glob.glob(os.path.join(HIST_DIR, '*.json'))):
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

from datetime import datetime
def get_age(dob, year):
    if not dob: return None
    try:
        d = datetime.strptime(dob, '%Y-%m-%d')
        age = year - d.year
        if d.month > 7 or (d.month == 7 and d.day > 1): age -= 1
        return age
    except: return None

# ── Build player lookup mlbam → players.json entry ───────────────────────────
mlbam_to_player = {}
for pid, p in players.items():
    if p.get('mlbam_id'):
        mlbam_to_player[str(p['mlbam_id'])] = p

# ── Collect observations: (age_diff, z_score, mlb_tool_grade) per level×stat ─
# Structure: obs[level][stat] = list of (age_diff, z_score, mlb_outcome)
obs_hitters  = defaultdict(lambda: defaultdict(list))
obs_pitchers = defaultdict(lambda: defaultdict(list))

for mlbam, tools in mlb_tools.items():
    player = mlbam_to_player.get(str(mlbam))
    if not player: continue
    is_p = tools['type'] == 'pitcher'
    target_stats = PITCHER_STATS if is_p else HITTER_STATS

    seasons = history.get(str(mlbam), [])
    milb = [s for s in seasons if s.get('level') in MILB_LEVELS and s['year'] in VALID_YEARS]
    if not milb: continue

    for s in milb:
        level  = s['level']
        year   = s['year']
        sample = ip_to_float(s.get('ip',0)) if is_p else (s.get('pa') or 0)
        if sample < (20 if is_p else 50): continue

        age = get_age(player.get('birthDate'), year)
        if age is None: continue
        age_diff = AVG_AGES[level] - age  # positive = younger than peers

        n_key = f"{level}|{year}"
        norm_entry = norms.get(n_key, {})
        n = norm_entry.get('pitchers' if is_p else 'hitters', {})
        if not n: continue

        for stat in target_stats:
            # Compute raw stat value
            raw = None
            if stat == 'k_pct':
                denom = ip_to_float(s.get('ip',0)) * 4.3 if is_p else sample
                k = s.get('so') or s.get('k') or 0
                raw = k / denom if denom > 0 else None
            elif stat == 'bb_pct':
                denom = ip_to_float(s.get('ip',0)) * 4.3 if is_p else sample
                bb = s.get('bb') or s.get('bb_allowed') or 0
                raw = bb / denom if denom > 0 else None
            elif stat == 'iso':
                raw = float(s.get('slg') or 0) - float(s.get('avg') or 0)
            elif stat == 'avg':
                raw = float(s.get('avg') or 0)
            elif stat == 'sb_rate':
                tob = (s.get('h') or 0) + (s.get('bb') or 0) + (s.get('hbp') or 0)
                raw = (s.get('sb') or 0) / tob if tob > 0 else None
            elif stat == 'baa':
                raw = float(s.get('baa') or 0) if s.get('baa') else None

            if raw is None: continue
            sn = n.get(stat)
            if not sn or sn['stdev'] == 0: continue

            z = (raw - sn['mean']) / sn['stdev']

            # MLB outcome for this tool
            if is_p:
                outcome = tools.get('stuff') if stat in ['k_pct','baa'] else tools.get('control')
            else:
                outcome = tools.get('power') if stat == 'iso' else \
                          tools.get('speed')  if stat == 'sb_rate' else \
                          tools.get('hit')

            if outcome is None: continue

            obs_pitchers[level][stat].append((age_diff, z, outcome))  if is_p else \
            obs_hitters[level][stat].append((age_diff, z, outcome))

# ── Fit elasticity coefficient per level × stat ───────────────────────────────
# We want k such that exp(k * age_diff) best amplifies z to predict outcome.
# Approach: regress (z * age_diff_term) → outcome, varying k via grid search.
# Simpler equivalent: correlate age_diff with (outcome - predicted_from_z_alone).
# We use: fit k as the slope of age_diff on residuals after z is accounted for,
# then convert to exp scale.

def fit_elasticity(observations, min_n=30):
    """
    observations: list of (age_diff, z, outcome)
    Returns k coefficient for exp(k * age_diff) multiplier.
    k=0 means age doesn't matter, k>0 means younger players get more credit.
    """
    if len(observations) < min_n:
        return {'k': 0.0, 'n': len(observations), 'note': 'insufficient data'}

    age_diffs = np.array([o[0] for o in observations])
    zscores   = np.array([o[1] for o in observations])
    outcomes  = np.array([o[2] for o in observations])

    # Step 1: how much does z alone predict outcome?
    if np.std(zscores) == 0:
        return {'k': 0.0, 'n': len(observations), 'note': 'no z variance'}

    # Fit z → outcome
    X_z = np.column_stack([zscores, np.ones(len(zscores))])
    coef_z, _, _, _ = np.linalg.lstsq(X_z, outcomes, rcond=None)
    residuals = outcomes - X_z @ coef_z

    # Step 2: does age_diff explain residuals?
    if np.std(age_diffs) == 0:
        return {'k': 0.0, 'n': len(observations), 'note': 'no age variance'}

    corr = np.corrcoef(age_diffs, residuals)[0, 1]

    # Step 3: convert correlation to k coefficient
    # k is the slope of age_diff on standardized residuals, scaled to exp space
    # We fit: residual ~ k_raw * age_diff, then k = k_raw / sd(residuals) * 0.15 baseline
    X_age = np.column_stack([age_diffs, np.ones(len(age_diffs))])
    coef_age, _, _, _ = np.linalg.lstsq(X_age, residuals, rcond=None)
    k_raw = coef_age[0]

    # Scale: outcome is in +scale (SD=15), age_diff in years
    # k_raw has units of +points per year of age_diff
    # Convert to dimensionless multiplier: k = k_raw / 15 (normalize by outcome SD)
    k = round(float(k_raw / 15), 4)
    # Cap to reasonable range
    k = max(-0.3, min(0.5, k))

    return {
        'k': k,
        'n': len(observations),
        'corr_age_residual': round(float(corr), 3),
    }

# ── Build output ──────────────────────────────────────────────────────────────
output = {'hitters': {}, 'pitchers': {}, 'default': 0.05}

print('─── HITTER ELASTICITY (k per level × stat) ───')
for level in sorted(AVG_AGES.keys()):
    output['hitters'][level] = {}
    for stat in HITTER_STATS:
        obs = obs_hitters[level][stat]
        result = fit_elasticity(obs)
        output['hitters'][level][stat] = result
        flag = f"  corr={result.get('corr_age_residual','?')}" if result['n'] >= 30 else f"  ** {result.get('note','')}"
        print(f"  {level:<12} {stat:<10} k={result['k']:>6.3f}  n={result['n']}{flag}")

print('\n─── PITCHER ELASTICITY (k per level × stat) ───')
for level in sorted(AVG_AGES.keys()):
    output['pitchers'][level] = {}
    for stat in PITCHER_STATS:
        obs = obs_pitchers[level][stat]
        result = fit_elasticity(obs)
        output['pitchers'][level][stat] = result
        flag = f"  corr={result.get('corr_age_residual','?')}" if result['n'] >= 30 else f"  ** {result.get('note','')}"
        print(f"  {level:<12} {stat:<10} k={result['k']:>6.3f}  n={result['n']}{flag}")

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'\nWrote age-elasticity.json')
