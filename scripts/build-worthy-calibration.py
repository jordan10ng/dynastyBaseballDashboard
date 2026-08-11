"""
build-worthy-calibration.py
Not a new regression — a thin logistic calibration on top of the EXISTING career
regression's predicted overall (regression.json), mapping it to P(worthy career):
debut-gated (>=4yr since MLB debut), career PA/IP >= threshold AND career grade >=
100. Testing (see project notes) found xbh_rate at AAA adds real incremental lift
for hitters specifically (nothing else tested did, for either side) — so the hitter
model takes [predicted_overall, xbh_rate_z_at_AAA], the pitcher model takes
[predicted_overall] alone.
Output: data/model/worthy-calibration.json
"""
import json, os, glob
from collections import defaultdict
from datetime import datetime
import numpy as np

BASE         = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS_PATH = os.path.join(BASE, 'players.json')
NORMS_PATH   = os.path.join(BASE, 'model', 'norms.json')
REGR_PATH    = os.path.join(BASE, 'model', 'regression.json')
PEAK_TOOLS_PATH = os.path.join(BASE, 'model', 'peak-tools.json')
OUTPUT       = os.path.join(BASE, 'model', 'worthy-calibration.json')

VALID_YEARS  = {2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026}
AVG_AGES     = {'AAA':26.4,'AA':24.0,'High-A':22.6,'Single-A':21.3,
                'Complex':19.9,'DSL':17.9,'Rookie':20.4}
MILB_LEVELS  = set(AVG_AGES.keys())
HIT_W = {'hit':0.42,'power':0.47,'speed':0.11}
PIT_W = {'stuff':0.70,'control':0.30}
TOOL_STATS = {
    'hit':     ('hitter',  ['k_pct','bb_pct']),
    'power':   ('hitter',  ['iso']),
    'speed':   ('hitter',  ['sb_rate']),
    'stuff':   ('pitcher', ['k_pct']),
    'control': ('pitcher', ['bb_pct']),
}

with open(PLAYERS_PATH) as f: players = json.load(f)
with open(NORMS_PATH) as f: norms = json.load(f)
with open(REGR_PATH) as f: regression = json.load(f)
with open(PEAK_TOOLS_PATH) as f: peak_tools = json.load(f)
level_models = regression['models']

mlbam_to_player = {str(p['mlbam_id']): p for p in players.values() if p.get('mlbam_id')}

history = defaultdict(list)
for path in sorted(glob.glob(os.path.join(BASE, 'history', '*.json'))):
    fname = os.path.basename(path).replace('.json','')
    if not fname.isdigit(): continue
    year = int(fname)
    with open(path) as f:
        for pid, seasons in json.load(f).items():
            for s in seasons: history[pid].append({**s, 'year': year})

def ip_to_float(ip):
    try:
        p = str(ip).split('.'); return int(p[0]) + (int(p[1]) if len(p) > 1 else 0) / 3
    except: return 0.0

def get_age(dob, year):
    if not dob: return None
    try:
        d = datetime.strptime(dob, '%Y-%m-%d'); age = year - d.year
        if d.month > 7 or (d.month == 7 and d.day > 1): age -= 1
        return age
    except: return None

# ── predicted_overall: same scoring logic as build-scores.js applies from regression.json ──
def score_player_tool(mlbam, is_p, tool, player):
    stats_for_tool = TOOL_STATS[tool][1]
    milb = [s for s in history.get(str(mlbam), []) if s.get('level') in MILB_LEVELS
            and s['year'] in VALID_YEARS and s.get('team')]
    if not milb: return None
    acc = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
    for s in milb:
        year, level = s['year'], s['level']
        sample = ip_to_float(s.get('ip',0)) if is_p else (s.get('pa') or 0)
        if sample < (15 if is_p else 30): continue
        n = norms.get(f"{level}|{year}", {}).get('pitchers' if is_p else 'hitters', {})
        if not n: continue
        age = get_age(player.get('birthDate'), year) or AVG_AGES[level]
        age_diff = AVG_AGES[level] - age
        raw = {}
        if not is_p:
            pa = sample
            raw['k_pct']  = (s.get('so') or 0) / pa
            raw['bb_pct'] = (s.get('bb') or 0) / pa
            raw['iso']    = float(s.get('slg') or 0) - float(s.get('avg') or 0)
            tob = (s.get('h') or 0) + (s.get('bb') or 0) + (s.get('hbp') or 0)
            raw['sb_rate'] = (s.get('sb') or 0) / tob if tob > 0 else 0
        else:
            bf = s.get('bf') or 0
            raw['k_pct']  = (s.get('so') or 0) / bf if bf > 0 else None
            raw['bb_pct'] = (s.get('bb') or 0) / bf if bf > 0 else None
        for stat in stats_for_tool:
            v = raw.get(stat)
            if v is None: continue
            sn = n.get(stat)
            if not sn or sn['stdev'] == 0: continue
            z = (v - sn['mean']) / sn['stdev']
            if (not is_p and stat == 'k_pct') or (is_p and stat == 'bb_pct'): z = -z
            a = acc[level][stat]
            a[0] += z * sample; a[1] += sample; a[2] += age_diff * sample
    weighted_sum = total_weight = 0.0
    for level, stats_acc in acc.items():
        for stat, (zsum, wsum, agesum) in stats_acc.items():
            if wsum <= 0: continue
            model = level_models.get(tool, {}).get(level, {}).get(stat)
            if not model: continue
            z_agg, age_agg = zsum / wsum, agesum / wsum
            predicted = model['slope_z']*z_agg + model.get('slope_age',0.0)*age_agg + model['intercept']
            weight = model['corr'] * wsum
            weighted_sum += predicted * weight; total_weight += weight
    if total_weight == 0: return None
    return weighted_sum / total_weight

def predicted_overall(mlbam, is_p, player):
    w = PIT_W if is_p else HIT_W
    num = den = 0.0
    for tool, wt in w.items():
        v = score_player_tool(mlbam, is_p, tool, player)
        if v is None: continue
        num += v*wt; den += wt
    if den == 0: return None
    return num/den

def xbh_rate_z_aaa(mlbam):
    """Hitter-only: sample-weighted xbh_rate z at AAA specifically (tested lift is AAA-specific)."""
    seasons = [s for s in history.get(str(mlbam), []) if s.get('level') == 'AAA'
               and s['year'] in VALID_YEARS and s.get('team')]
    zsum = wsum = 0.0
    for s in seasons:
        pa = s.get('pa') or 0
        if pa < 30: continue
        n = norms.get(f"AAA|{s['year']}", {}).get('hitters', {})
        sn = n.get('xbh_rate')
        if not sn or sn['stdev'] == 0: continue
        doubles, triples, hr = s.get('doubles') or 0, s.get('triples') or 0, s.get('hr') or 0
        xbh_rate = (doubles+triples+hr) / pa
        z = (xbh_rate - sn['mean']) / sn['stdev']
        zsum += z*pa; wsum += pa
    return (zsum/wsum) if wsum > 0 else 0.0   # 0.0 = league-average default when no AAA sample

# ── build training set ──
def fit_logistic(X, y, n_iter=50):
    Xd = np.column_stack([np.ones(len(y)), X])
    beta = np.zeros(Xd.shape[1])
    for _ in range(n_iter):
        eta = np.clip(Xd @ beta, -30, 30)
        p = 1/(1+np.exp(-eta))
        W = np.clip(p*(1-p), 1e-6, None)
        grad = Xd.T @ (y - p)
        H = (Xd.T * W) @ Xd
        try:
            delta = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            delta = np.linalg.lstsq(H, grad, rcond=None)[0]
        beta = beta + delta
        if np.max(np.abs(delta)) < 1e-9: break
    return beta

def auc(scores, labels):
    scores, labels = np.array(scores), np.array(labels)
    ranks = np.argsort(np.argsort(scores)) + 1
    n1 = labels.sum(); n0 = len(labels)-n1
    if n1 == 0 or n0 == 0: return None
    return float((ranks[labels==1].sum() - n1*(n1+1)/2) / (n1*n0))

rows = {'hitter': [], 'pitcher': []}
for mlbam, pt in peak_tools.items():
    if pt['type'] == 'two-way': continue   # calibrate on pure players only
    worthy = pt.get('_worthy')
    if worthy is None: continue            # too new to judge (debut gate)
    player = mlbam_to_player.get(str(mlbam))
    if not player: continue
    is_p = pt['type'] == 'pitcher'
    pred = predicted_overall(mlbam, is_p, player)
    if pred is None: continue
    if is_p:
        rows['pitcher'].append((pred, worthy))
    else:
        xbh = xbh_rate_z_aaa(mlbam)
        rows['hitter'].append((pred, xbh, worthy))

output = {}

# hitters: [predicted_overall, xbh_z_aaa]
h = rows['hitter']
X = np.array([[r[0], r[1]] for r in h]); y = np.array([r[2] for r in h])
beta = fit_logistic(X, y)
fitted = 1/(1+np.exp(-(beta[0] + beta[1]*X[:,0] + beta[2]*X[:,1])))
print(f"HITTER calibration: n={len(h)} positives={int(y.sum())}  AUC={auc(fitted,y):.3f}")
print(f"  intercept={beta[0]:.4f}  coef_overall={beta[1]:.4f}  coef_xbh_aaa={beta[2]:.4f}")
output['hitter'] = {'intercept': round(float(beta[0]),4), 'coef_overall': round(float(beta[1]),4),
                     'coef_xbh_aaa': round(float(beta[2]),4), 'n': len(h), 'auc': round(auc(fitted,y),4)}

# pitchers: [predicted_overall] only
p = rows['pitcher']
X = np.array([[r[0]] for r in p]); y = np.array([r[1] for r in p])
beta = fit_logistic(X, y)
fitted = 1/(1+np.exp(-(beta[0] + beta[1]*X[:,0])))
print(f"PITCHER calibration: n={len(p)} positives={int(y.sum())}  AUC={auc(fitted,y):.3f}")
print(f"  intercept={beta[0]:.4f}  coef_overall={beta[1]:.4f}")
output['pitcher'] = {'intercept': round(float(beta[0]),4), 'coef_overall': round(float(beta[1]),4),
                      'n': len(p), 'auc': round(auc(fitted,y),4)}

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'\nWrote worthy-calibration.json')
