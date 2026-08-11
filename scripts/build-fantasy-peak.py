"""
build-fantasy-peak.py
Peak3 projections for actual fantasy-relevant rate stats (not the 5 abstract tool
grades) — AVG/OBP/SLG/OPS/HR-rate/3B-rate/RBI-rate/R-rate/2B-rate for hitters,
WHIP/BAA/ERA/K-BB% for pitchers. Same per-level weighted-z + age_diff architecture
as build-peak-regression.py, generalized to 1-2 predictors per stat, using whichever
predictor set testing found best per stat (self-predict for most; FIP-style K%+BB%
for ERA; K%+BB% for WHIP; K% alone for BAA; OBP+SB-rate for R-rate). 2B-rate is
included despite weak signal (~0.13 corr) — deliberately kept rather than dropped.
Output: data/model/fantasy-peak-regression.json
"""
import json, os, glob
from collections import defaultdict
from datetime import datetime
import numpy as np

BASE       = os.environ.get('DATA_BASE', os.path.expanduser('~/Desktop/fantasy-baseball/data'))
PLAYERS    = os.path.join(BASE, 'players.json')
HIST_DIR   = os.path.join(BASE, 'history')
NORMS_PATH = os.path.join(BASE, 'model', 'norms.json')
PEAK_REGR_PATH = os.path.join(BASE, 'model', 'peak-regression.json')
POOL_STATS_PATH = os.path.join(BASE, 'model', 'pool-stats.json')
OUTPUT     = os.path.join(BASE, 'model', 'fantasy-peak-regression.json')

VALID_YEARS  = {2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026}
AVG_AGES     = {'AAA':26.4,'AA':24.0,'High-A':22.6,'Single-A':21.3,'Complex':19.9,'DSL':17.9,'Rookie':20.4}
MILB_LEVELS  = set(AVG_AGES.keys())
LEVELS_ORDER = ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA']
MIN_PA_TARGET = 100
MIN_N = 20
POOL_CENTER, POOL_STDEV = 95, 15

with open(PLAYERS) as f: players = json.load(f)
with open(NORMS_PATH) as f: norms = json.load(f)
with open(PEAK_REGR_PATH) as f: peak_regression = json.load(f)
# pool-stats.json is written by build-scores.js (runs *after* this script) — read the
# existing committed copy. Slightly stale (one pipeline cycle behind) but the prospect
# pool's mean/stdev barely moves day to day, and this is the exact pool career-regression
# already norms peak3 against (see build-scores.js), so tool-calibrated stats stay on the
# same scale as peak3 itself rather than drifting to a self-referential one.
with open(POOL_STATS_PATH) as f: pool_stats = json.load(f)

history = defaultdict(list)
for path in sorted(glob.glob(os.path.join(HIST_DIR, '*.json'))):
    fname = os.path.basename(path).replace('.json','')
    if not fname.isdigit(): continue
    year = int(fname)
    with open(path) as f:
        for pid, seasons in json.load(f).items():
            for s in seasons: history[pid].append({**s, 'year': year})

mlbam_to_player = {str(p['mlbam_id']): p for p in players.values() if p.get('mlbam_id')}

def get_age(dob, year):
    if not dob: return None
    try:
        d = datetime.strptime(dob, '%Y-%m-%d'); age = year - d.year
        if d.month > 7 or (d.month == 7 and d.day > 1): age -= 1
        return age
    except: return None

def sample_of(s, is_p):
    if is_p:
        try:
            p = str(s.get('ip', 0)).split('.'); return int(p[0]) + (int(p[1]) if len(p) > 1 else 0) / 3
        except: return 0.0
    return s.get('pa') or 0

# ── predictor extractors: 'ratio' (field/den), 'direct' (string field), 'sb_rate' (special denom) ──
def extract(kind, s, *args):
    if kind == 'direct':
        v = s.get(args[0]); return float(v) if v not in (None, '') else None
    if kind == 'ratio':
        field, den = args
        d = s.get(den) or 0
        return (s.get(field) or 0) / d if d > 0 else None
    if kind == 'sb_rate':
        h, bb, hbp = s.get('h') or 0, s.get('bb') or 0, s.get('hbp') or 0
        doubles, triples, hr = s.get('doubles') or 0, s.get('triples') or 0, s.get('hr') or 0
        opp = (h - doubles - triples - hr) + bb + hbp
        return (s.get('sb') or 0) / opp if opp > 0 else None
    if kind == 'kbb':
        bf = s.get('bf') or 0
        return ((s.get('so') or 0) - (s.get('bb') or 0)) / bf if bf > 0 else None
    if kind == 'iso':
        ab = s.get('ab') or 0
        if ab <= 0: return None
        return float(s.get('slg') or 0) - (s.get('h') or 0) / ab
    if kind == 'xbh':
        d = s.get(args[0]) or 0
        if d <= 0: return None
        return ((s.get('doubles') or 0) + (s.get('triples') or 0) + (s.get('hr') or 0)) / d
    return None

STAT_CONFIG = {
    'avg':      {'is_p': False, 'predictors': [('ratio','h','ab')],           'higher_better': True},
    'obp':      {'is_p': False, 'predictors': [('direct','obp')],             'higher_better': True},
    'slg':      {'is_p': False, 'predictors': [('direct','slg')],             'higher_better': True},
    'ops':      {'is_p': False, 'predictors': [('direct','ops')],             'higher_better': True},
    'hr_rate':  {'is_p': False, 'predictors': [('ratio','hr','ab')],          'higher_better': True},
    '3b_rate':  {'is_p': False, 'predictors': [('ratio','triples','pa')],     'higher_better': True},
    'rbi_rate': {'is_p': False, 'predictors': [('ratio','rbi','pa')],         'higher_better': True},
    'r_rate':   {'is_p': False, 'predictors': [('direct','obp'), ('sb_rate',)], 'higher_better': True},
    '2b_rate':  {'is_p': False, 'predictors': [('ratio','doubles','pa')],     'higher_better': True},
    'whip':     {'is_p': True,  'predictors': [('ratio','bb','bf'), ('ratio','so','bf')], 'higher_better': False},
    'baa':      {'is_p': True,  'predictors': [('ratio','so','bf')],          'higher_better': False},
    'era':      {'is_p': True,  'predictors': [('ratio','so','bf'), ('ratio','bb','bf')], 'higher_better': False},
    'k_bb_pct': {'is_p': True,  'predictors': [('ratio','so','bf'), ('ratio','bb','bf')], 'higher_better': True},
    # added to fill every table slot — self-predict, same rigor as everything above.
    # k_pct_hit/bb_pct_hit/iso/xbh_pct/sb_rate let the display layer derive SO/BB/H/2B-3B-HR/
    # SB counts instead of leaving those columns blank; k_pct_pit/bb_pct_pit/hr_rate do the
    # same for pitcher SO/BB/HR.
    'k_pct_hit':  {'is_p': False, 'predictors': [('ratio','so','pa')],        'higher_better': False},
    'bb_pct_hit': {'is_p': False, 'predictors': [('ratio','bb','pa')],        'higher_better': True},
    'iso':        {'is_p': False, 'predictors': [('iso',)],                   'higher_better': True},
    'xbh_pct':    {'is_p': False, 'predictors': [('xbh','pa')],               'higher_better': True},
    'sb_rate':    {'is_p': False, 'predictors': [('sb_rate',)],               'higher_better': True},
    'k_pct_pit':  {'is_p': True,  'predictors': [('ratio','so','bf')],        'higher_better': True},
    'bb_pct_pit': {'is_p': True,  'predictors': [('ratio','bb','bf')],        'higher_better': False},
    'hr_rate_pit':{'is_p': True,  'predictors': [('ratio','hr','bf')],        'higher_better': False},
}

# Tool-calibration stats — tested head-to-head against the direct self-predict regression
# above (same target, same population): for these 8, mapping the ALREADY-differentiated
# peak tool grade (Power+/Speed+/etc, pool-normed the same way peak3 itself is) through an
# empirical tool-grade -> raw-stat calibration wins on accuracy, width, or both. The other
# 13 stay on the direct regression because tool-calibration either loses real accuracy
# (e.g. AVG, K%) or collapses outright (BB%: Hit+ dilutes it to 1-of-3 equal components,
# corr 0.60 -> 0.08). is_p/higher_better for target extraction still come from STAT_CONFIG.
TOOL_CAL_CONFIG = {
    'sb_rate':      ['speed'],
}

# Hybrid — direct self-predict PLUS the pool-normed tool grade(s) as an additional term
# (not a replacement). Tested across all 21 stats, not just AVG/OBP: hybrid beat whichever
# of direct/tool_cal previously won for 10 of them, by a real margin (>0.005 corr) in every
# case — SLG 0.498->0.525, OPS 0.456->0.492, HR rate 0.624->0.630, 3B rate 0.433->0.471,
# RBI rate 0.437->0.462, R rate 0.394->0.402, 2B rate 0.159->0.182, ISO 0.611->0.623,
# XBH% 0.512->0.535, HR rate allowed 0.177->0.250. The remaining 9 (WHIP/BAA/ERA/K-BB%/
# K%+BB% hit+pit/SB rate) showed no gain worth the added complexity — left as direct or
# tool_cal, whichever already won.
HYBRID_CONFIG = {
    'avg':          ['hit'],
    'obp':          ['hit'],
    'hr_rate':      ['power'],
    '3b_rate':      ['speed'],
    'rbi_rate':     ['power', 'hit'],
    'r_rate':       ['hit', 'speed'],
    '2b_rate':      ['power', 'speed'],
    'iso':          ['power'],
    'xbh_pct':      ['power', 'speed'],
    'hr_rate_pit':  ['stuff', 'control'],
}
# slg/ops are handled by DERIVED_CONFIG below (composed from other stats, not their own fit).

# target extraction mirrors predictor extraction, but avg/whip/era/baa/k_bb_pct targets
# need their own (possibly different-shaped) formula — reuse the first predictor's kind
# where it matches 1:1, else define explicitly.
TARGET_EXTRACT = {
    'avg':      lambda s: extract('ratio', s, 'h', 'ab'),
    'obp':      lambda s: extract('direct', s, 'obp'),
    'slg':      lambda s: extract('direct', s, 'slg'),
    'ops':      lambda s: extract('direct', s, 'ops'),
    'hr_rate':  lambda s: extract('ratio', s, 'hr', 'ab'),
    '3b_rate':  lambda s: extract('ratio', s, 'triples', 'pa'),
    'rbi_rate': lambda s: extract('ratio', s, 'rbi', 'pa'),
    'r_rate':   lambda s: extract('ratio', s, 'r', 'pa'),
    '2b_rate':  lambda s: extract('ratio', s, 'doubles', 'pa'),
    'whip':     lambda s: extract('direct', s, 'whip'),
    'baa':      lambda s: extract('direct', s, 'baa'),
    'era':      lambda s: extract('direct', s, 'era'),
    'k_bb_pct': lambda s: extract('kbb', s),
    'k_pct_hit':  lambda s: extract('ratio', s, 'so', 'pa'),
    'bb_pct_hit': lambda s: extract('ratio', s, 'bb', 'pa'),
    'iso':        lambda s: extract('iso', s),
    'xbh_pct':    lambda s: extract('xbh', s, 'pa'),
    'sb_rate':    lambda s: extract('sb_rate', s),
    'k_pct_pit':  lambda s: extract('ratio', s, 'so', 'bf'),
    'bb_pct_pit': lambda s: extract('ratio', s, 'bb', 'bf'),
    'hr_rate_pit':lambda s: extract('ratio', s, 'hr', 'bf'),
}

def build_custom_norm(kind_args, is_p):
    """ad hoc level-year mean/stdev for predictor stats not already in norms.json."""
    buckets = defaultdict(list)
    ttype = 'pitching' if is_p else 'hitting'
    for mlbam, seasons in history.items():
        for s in seasons:
            if s.get('level') not in MILB_LEVELS or s['year'] not in VALID_YEARS or not s.get('team'): continue
            if s.get('type') != ttype: continue
            samp = sample_of(s, is_p)
            if samp < (15 if is_p else 30): continue
            v = extract(kind_args[0], s, *kind_args[1:])
            if v is None: continue
            buckets[(s['level'], s['year'])].append((v, samp))
    norm = {}
    for k, pairs in buckets.items():
        if len(pairs) < 20: continue
        vals = np.array([p[0] for p in pairs]); w = np.array([p[1] for p in pairs])
        mean = np.average(vals, weights=w); var = np.average((vals-mean)**2, weights=w)
        norm[k] = {'mean': float(mean), 'stdev': max(float(var**0.5), 1e-9)}
    return norm

def norm_lookup_fn(pred):
    kind = pred[0]
    if kind == 'direct' and pred[1] in ('obp','slg','ops'):
        side = 'hitters'
        return lambda level, year: norms.get(f"{level}|{year}", {}).get(side, {}).get(pred[1])
    if kind == 'direct' and pred[1] in ('era','whip','baa'):
        side = 'pitchers'
        return lambda level, year: norms.get(f"{level}|{year}", {}).get(side, {}).get(pred[1])
    if kind == 'ratio' and pred[1] == 'so' and pred[2] == 'bf':
        side = 'pitchers'
        return lambda level, year: norms.get(f"{level}|{year}", {}).get(side, {}).get('k_pct')
    if kind == 'ratio' and pred[1] == 'bb' and pred[2] == 'bf':
        side = 'pitchers'
        return lambda level, year: norms.get(f"{level}|{year}", {}).get(side, {}).get('bb_pct')
    if kind == 'ratio' and pred[1] == 'so' and pred[2] == 'pa':
        return lambda level, year: norms.get(f"{level}|{year}", {}).get('hitters', {}).get('k_pct')
    if kind == 'ratio' and pred[1] == 'bb' and pred[2] == 'pa':
        return lambda level, year: norms.get(f"{level}|{year}", {}).get('hitters', {}).get('bb_pct')
    if kind == 'iso':
        return lambda level, year: norms.get(f"{level}|{year}", {}).get('hitters', {}).get('iso')
    if kind == 'xbh' and pred[1] == 'pa':
        return lambda level, year: norms.get(f"{level}|{year}", {}).get('hitters', {}).get('xbh_rate')
    # everything else: build an ad hoc norm keyed off this exact extractor
    is_p = pred[0] in ('kbb',) or (kind == 'ratio' and pred[2] == 'bf')
    adhoc = build_custom_norm(pred, is_p)
    return lambda level, year: adhoc.get((level, year))

def mlb_peak3_target(mlbam, stat, higher_better):
    cfg = STAT_CONFIG[stat]
    is_p = cfg['is_p']
    fn = TARGET_EXTRACT[stat]
    ttype = 'pitching' if is_p else 'hitting'
    min_s = 15 if is_p else MIN_PA_TARGET
    seasons = sorted([s for s in history.get(str(mlbam), []) if s.get('level') == 'MLB'
                       and s.get('type') == ttype and s['year'] in VALID_YEARS
                       and sample_of(s, is_p) >= min_s], key=lambda s: s['year'])
    if not seasons: return None
    best = None
    for i in range(len(seasons)):
        y0 = seasons[i]['year']; chunk = [s for s in seasons if y0 <= s['year'] < y0 + 3]
        vals = [(fn(s), sample_of(s, is_p)) for s in chunk]
        vals = [(v, w) for v, w in vals if v is not None]
        if not vals: continue
        d = sum(w for v, w in vals)
        if d <= 0: continue
        val = sum(v*w for v, w in vals) / d
        if best is None: best = val
        elif higher_better and val > best: best = val
        elif not higher_better and val < best: best = val
    return best

# ── tool-calibration path ────────────────────────────────────────────────────────────
TOOL_STATS = {'hit': ['k_pct','bb_pct'], 'power': ['iso'], 'speed': ['sb_rate'],
              'stuff': ['k_pct'], 'control': ['bb_pct']}

def predict_raw_tool_peak(mlbam, player, tool):
    """Mirrors build-scores.js's scoreToolPeak: weighted z + age_diff per level, fit
    against peak-regression.json, corr-weighted blend across levels. Pre-pool-norm."""
    is_p = tool in ('stuff', 'control')
    ttype = 'pitching' if is_p else 'hitting'
    models_tool = peak_regression['models'].get(tool, {})
    milb = [s for s in history.get(str(mlbam), []) if s.get('level') in MILB_LEVELS
            and s['year'] in VALID_YEARS and s.get('team') and s.get('type') == ttype]
    if not milb: return None
    acc = defaultdict(lambda: defaultdict(lambda: [0.0,0.0,0.0]))
    for s in milb:
        samp = sample_of(s, is_p)
        if samp < (15 if is_p else 30): continue
        for stat in TOOL_STATS[tool]:
            side = 'pitchers' if is_p else 'hitters'
            n = norms.get(f"{s['level']}|{s['year']}", {}).get(side, {}).get(stat)
            if not n or n['stdev'] == 0: continue
            if stat == 'k_pct':
                d = s.get('bf') if is_p else s.get('pa')
                v = (s.get('so') or 0)/d if d else None
            elif stat == 'bb_pct':
                d = s.get('bf') if is_p else s.get('pa')
                v = (s.get('bb') or 0)/d if d else None
            elif stat == 'iso':
                v = extract('iso', s)
            elif stat == 'sb_rate':
                v = extract('sb_rate', s)
            if v is None: continue
            z = (v - n['mean']) / n['stdev']
            if (not is_p and stat == 'k_pct') or (is_p and stat == 'bb_pct'): z = -z
            age = get_age(player.get('birthDate'), s['year']) or AVG_AGES[s['level']]
            age_diff = AVG_AGES[s['level']] - age
            a = acc[s['level']][stat]
            a[0] += z*samp; a[1] += samp; a[2] += age_diff*samp
    wsum = wtot = 0.0
    for level, stats_acc in acc.items():
        for stat, (zsum, w, agesum) in stats_acc.items():
            if w <= 0: continue
            model = models_tool.get(level, {}).get(stat)
            if not model: continue
            z_agg, age_agg = zsum/w, agesum/w
            pred = model['slope_z']*z_agg + model.get('slope_age',0)*age_agg + model['intercept']
            weight = model['corr']*w
            wsum += pred*weight; wtot += weight
    return wsum/wtot if wtot > 0 else None

def pool_norm_tool(tool, raw):
    ps = pool_stats.get(tool)
    if not ps or raw is None: return None
    return POOL_CENTER + ((raw - ps['mean']) / ps['stdev']) * POOL_STDEV

def fit_tool_cal(stat):
    cfg = STAT_CONFIG[stat]
    is_p, higher_better = cfg['is_p'], cfg['higher_better']
    tools = TOOL_CAL_CONFIG[stat]
    rows = []
    for mlbam, player in mlbam_to_player.items():
        target = mlb_peak3_target(mlbam, stat, higher_better)
        if target is None: continue
        normed = [pool_norm_tool(t, predict_raw_tool_peak(mlbam, player, t)) for t in tools]
        if any(n is None for n in normed): continue
        rows.append((normed, target))
    if len(rows) < MIN_N:
        return {'method': 'tool_cal', 'is_pitcher': is_p, 'tools': tools,
                'coef': None, 'validation': {'r2': None, 'corr': None, 'n': len(rows)}}
    X = np.column_stack([np.array([r[0][i] for r in rows]) for i in range(len(tools))] + [np.ones(len(rows))])
    y = np.array([r[1] for r in rows])
    coef, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ coef
    ss_res = np.sum((y-fitted)**2); ss_tot = np.sum((y-y.mean())**2)
    r2 = round(1 - ss_res/ss_tot, 4) if ss_tot > 0 else None
    corr = round(float(np.corrcoef(fitted, y)[0,1]), 4)
    return {
        'method': 'tool_cal', 'is_pitcher': is_p, 'tools': tools,
        'coef': [round(float(x),6) for x in coef],
        'validation': {'r2': r2, 'corr': corr, 'n': len(rows)},
    }

def _fit_direct_models(stat):
    """Core per-level z + age + age^2 fit, shared by 'direct' and 'hybrid' methods.
    Returns (level_models, {mlbam: direct_pred}, predictors, is_p, higher_better)."""
    cfg = STAT_CONFIG[stat]
    is_p, predictors, higher_better = cfg['is_p'], cfg['predictors'], cfg['higher_better']
    norm_fns = [norm_lookup_fn(p) for p in predictors]
    ttype = 'pitching' if is_p else 'hitting'

    obs = defaultdict(list)
    for mlbam, player in mlbam_to_player.items():
        milb = [s for s in history.get(str(mlbam), []) if s.get('level') in MILB_LEVELS
                and s['year'] in VALID_YEARS and s.get('team') and s.get('type') == ttype]
        if not milb: continue
        acc = defaultdict(lambda: {'z': [0.0]*len(predictors), 'w': 0.0, 'age': 0.0})
        for s in milb:
            samp = sample_of(s, is_p)
            if samp < (15 if is_p else 30): continue
            zs = []
            ok = True
            for pred, nfn in zip(predictors, norm_fns):
                n = nfn(s['level'], s['year'])
                if not n or n['stdev'] == 0: ok = False; break
                v = extract(pred[0], s, *pred[1:])
                if v is None: ok = False; break
                zs.append((v - n['mean']) / n['stdev'])
            if not ok: continue
            age = get_age(player.get('birthDate'), s['year']) or AVG_AGES[s['level']]
            age_diff = AVG_AGES[s['level']] - age
            a = acc[s['level']]
            for i, z in enumerate(zs): a['z'][i] += z*samp
            a['w'] += samp; a['age'] += age_diff*samp
        target = mlb_peak3_target(mlbam, stat, higher_better)
        if target is None: continue
        for level, a in acc.items():
            if a['w'] <= 0: continue
            obs[level].append(([z/a['w'] for z in a['z']], a['age']/a['w'], target, a['w'], mlbam))

    level_models = {}
    for level in LEVELS_ORDER:
        pairs = obs.get(level, [])
        if len(pairs) < MIN_N: continue
        cols = [np.array([p[0][i] for p in pairs]) for i in range(len(predictors))]
        ages = np.array([p[1] for p in pairs]); outcomes = np.array([p[2] for p in pairs])
        # age^2 (nonlinear career-arc term) — tested, adds real lift across every stat
        # (AVG +0.008, SLG +0.020, OPS +0.023, WHIP +0.038, shipped-FIP ERA +0.011) with
        # no downside found. Aging curves genuinely aren't linear.
        X = np.column_stack(cols + [ages, ages**2, np.ones(len(pairs))])
        coef, _, _, _ = np.linalg.lstsq(X, outcomes, rcond=None)
        fitted = X @ coef
        c = float(np.corrcoef(fitted, outcomes)[0,1])
        level_models[level] = {'coef': [round(float(x),6) for x in coef], 'corr': round(c,4), 'n': len(pairs)}

    per_mlbam_acc = defaultdict(dict)
    for level, pairs in obs.items():
        for zs, age_agg, target, w, mlbam in pairs:
            per_mlbam_acc[mlbam][level] = (zs, age_agg, w)
    direct_pred = {}
    for mlbam in mlbam_to_player:
        wsum_all = wtot_all = 0.0
        for level, (zs, age_agg, w) in per_mlbam_acc.get(mlbam, {}).items():
            model = level_models.get(level)
            if not model: continue
            x = zs + [age_agg, age_agg**2, 1.0]
            pred = sum(c*v for c, v in zip(model['coef'], x))
            weight = model['corr']*w
            wsum_all += pred*weight; wtot_all += weight
        if wtot_all == 0: continue
        direct_pred[mlbam] = wsum_all/wtot_all
    return level_models, direct_pred, predictors, is_p, higher_better

def fit_stat(stat):
    level_models, direct_pred, predictors, is_p, higher_better = _fit_direct_models(stat)
    preds, actuals = [], []
    for mlbam, pred in direct_pred.items():
        target = mlb_peak3_target(mlbam, stat, higher_better)
        if target is None: continue
        preds.append(pred); actuals.append(target)
    r2 = corr = None
    if len(preds) >= 15:
        preds_a, actuals_a = np.array(preds), np.array(actuals)
        ss_res = np.sum((actuals_a-preds_a)**2); ss_tot = np.sum((actuals_a-actuals_a.mean())**2)
        r2 = round(1 - ss_res/ss_tot, 4) if ss_tot > 0 else None
        corr = round(float(np.corrcoef(preds_a, actuals_a)[0,1]), 4)

    return {
        'method': 'direct',
        'is_pitcher': is_p,
        'predictors': [list(p) for p in predictors],
        'models': level_models,
        'validation': {'r2': r2, 'corr': corr, 'n': len(preds)},
    }

def fit_hybrid(stat):
    """Direct per-level prediction PLUS the pool-normed tool grade as a final 2-term
    blend — tested for AVG/OBP specifically: beats direct-alone on both accuracy and
    width (AVG 0.400->0.416 corr, OBP 0.436->0.447), because Hit+'s K%/BB% components
    carry a little real signal about contact ability that the pure AVG/OBP self-predict
    doesn't fully capture on its own. Tool-alone lost outright (Hit+ dilutes AVG/OBP down
    to 1-of-3 equal components) — this only works as an ADDITION, not a replacement."""
    tools = HYBRID_CONFIG[stat]
    level_models, direct_pred, predictors, is_p, higher_better = _fit_direct_models(stat)
    rows = []
    for mlbam, player in mlbam_to_player.items():
        if mlbam not in direct_pred: continue
        target = mlb_peak3_target(mlbam, stat, higher_better)
        if target is None: continue
        normed = [pool_norm_tool(t, predict_raw_tool_peak(mlbam, player, t)) for t in tools]
        if any(n is None for n in normed): continue
        rows.append((direct_pred[mlbam], normed, target))
    if len(rows) < MIN_N:
        return {'method': 'hybrid', 'is_pitcher': is_p, 'predictors': [list(p) for p in predictors],
                'models': level_models, 'tools': tools, 'blend_coef': None,
                'validation': {'r2': None, 'corr': None, 'n': len(rows)}}
    X = np.column_stack([np.array([r[0] for r in rows])] +
                         [np.array([r[1][i] for r in rows]) for i in range(len(tools))] +
                         [np.ones(len(rows))])
    y = np.array([r[2] for r in rows])
    coef, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ coef
    ss_res = np.sum((y-fitted)**2); ss_tot = np.sum((y-y.mean())**2)
    r2 = round(1 - ss_res/ss_tot, 4) if ss_tot > 0 else None
    corr = round(float(np.corrcoef(fitted, y)[0,1]), 4)
    return {
        'method': 'hybrid', 'is_pitcher': is_p, 'predictors': [list(p) for p in predictors],
        'models': level_models, 'tools': tools,
        'blend_coef': [round(float(x),6) for x in coef],
        'validation': {'r2': r2, 'corr': corr, 'n': len(rows)},
    }

# Derived stats — composed from already-fit components at scoring time, not their own
# regression. Guarantees the arithmetic identity holds exactly (SLG=AVG+ISO, OPS=OBP+SLG
# always true for real stats — independently fitting all of AVG/ISO/SLG/OBP/OPS let them
# silently disagree, e.g. AVG+ISO vs SLG off by .03, OBP+SLG vs OPS off by up to .15 for
# some players). Tested deriving all 4 candidate identities found in the data (SLG, OPS,
# XBH%, K-BB%): SLG and OPS cost ~nothing (-0.004 / -0.006 corr) so they're derived; XBH%
# and K-BB% cost real accuracy (-0.033 / -0.043) for a smaller inconsistency to begin with,
# so those two stay independently fit. DERIVED_ORDER matters — OPS composes SLG, so SLG
# must be resolved first.
DERIVED_CONFIG = {
    'slg': [('avg', 1), ('iso', 1)],
    'ops': [('obp', 1), ('slg', 1)],
}
DERIVED_ORDER = ['slg', 'ops']

def predict_stat_value(mlbam, player, stat, resolved):
    """Re-predicts a single stat for one player from its already-fitted model, for
    validating the derived stats. Mirrors build-scores.js's scoreFantasyStat."""
    if stat in resolved: return resolved[stat]
    cfg = output[stat]
    method = cfg['method']
    if method == 'derived':
        total = 0.0
        for comp, sign in DERIVED_CONFIG[stat]:
            v = predict_stat_value(mlbam, player, comp, resolved)
            if v is None: return None
            total += sign * v
        return total
    if method == 'tool_cal':
        vals = [pool_norm_tool(t, predict_raw_tool_peak(mlbam, player, t)) for t in cfg['tools']]
        if any(v is None for v in vals) or not cfg['coef']: return None
        return sum(c*(vals[i] if i < len(vals) else 1) for i, c in enumerate(cfg['coef']))
    # direct or hybrid — need the per-level direct prediction
    is_p = cfg['is_pitcher']
    predictors = [tuple(p) for p in cfg['predictors']]
    norm_fns = [norm_lookup_fn(p) for p in predictors]
    ttype = 'pitching' if is_p else 'hitting'
    milb = [s for s in history.get(str(mlbam), []) if s.get('level') in MILB_LEVELS
            and s['year'] in VALID_YEARS and s.get('team') and s.get('type') == ttype]
    acc = defaultdict(lambda: {'z': [0.0]*len(predictors), 'w': 0.0, 'age': 0.0})
    for s in milb:
        samp = sample_of(s, is_p)
        if samp < (15 if is_p else 30): continue
        zs = []; ok = True
        for pred, nfn in zip(predictors, norm_fns):
            n = nfn(s['level'], s['year'])
            if not n or n['stdev'] == 0: ok = False; break
            v = extract(pred[0], s, *pred[1:])
            if v is None: ok = False; break
            zs.append((v - n['mean']) / n['stdev'])
        if not ok: continue
        age = get_age(player.get('birthDate'), s['year']) or AVG_AGES[s['level']]
        age_diff = AVG_AGES[s['level']] - age
        a = acc[s['level']]
        for i, z in enumerate(zs): a['z'][i] += z*samp
        a['w'] += samp; a['age'] += age_diff*samp
    wsum_all = wtot_all = 0.0
    for level, a in acc.items():
        if a['w'] <= 0: continue
        model = cfg['models'].get(level)
        if not model: continue
        x = [z/a['w'] for z in a['z']] + [a['age']/a['w'], (a['age']/a['w'])**2, 1.0]
        pred = sum(c*v for c, v in zip(model['coef'], x))
        weight = model['corr']*a['w']
        wsum_all += pred*weight; wtot_all += weight
    direct_pred = wsum_all/wtot_all if wtot_all > 0 else None
    if method == 'direct': return direct_pred
    if method == 'hybrid':
        if direct_pred is None: return None
        tvals = [pool_norm_tool(t, predict_raw_tool_peak(mlbam, player, t)) for t in cfg['tools']]
        if any(v is None for v in tvals): return None
        x = [direct_pred] + tvals
        return sum(c*(x[i] if i < len(x) else 1) for i, c in enumerate(cfg['blend_coef']))
    return None

output = {}
print(f"{'stat':<12}{'method':<9}{'R2':>8}{'corr':>8}{'n':>6}")
for stat in STAT_CONFIG:
    if stat in DERIVED_CONFIG:
        output[stat] = {'method': 'derived', 'is_pitcher': STAT_CONFIG[stat]['is_p'],
                         'formula': DERIVED_CONFIG[stat], 'validation': {'r2': None, 'corr': None, 'n': 0}}
        continue
    if stat in TOOL_CAL_CONFIG: result = fit_tool_cal(stat)
    elif stat in HYBRID_CONFIG: result = fit_hybrid(stat)
    else: result = fit_stat(stat)
    output[stat] = result
    v = result['validation']
    print(f"{stat:<12}{result['method']:<9}{v['r2'] if v['r2'] is not None else '--':>8}{v['corr'] if v['corr'] is not None else '--':>8}{v['n']:>6}")

# Now that every component stat is fit, resolve + validate the derived ones in order.
for stat in DERIVED_ORDER:
    higher_better = STAT_CONFIG[stat]['higher_better']
    preds, actuals = [], []
    for mlbam, player in mlbam_to_player.items():
        target = mlb_peak3_target(mlbam, stat, higher_better)
        if target is None: continue
        pred = predict_stat_value(mlbam, player, stat, {})
        if pred is None: continue
        preds.append(pred); actuals.append(target)
    r2 = corr = None
    if len(preds) >= 15:
        preds_a, actuals_a = np.array(preds), np.array(actuals)
        ss_res = np.sum((actuals_a-preds_a)**2); ss_tot = np.sum((actuals_a-actuals_a.mean())**2)
        r2 = round(1 - ss_res/ss_tot, 4) if ss_tot > 0 else None
        corr = round(float(np.corrcoef(preds_a, actuals_a)[0,1]), 4)
    output[stat]['validation'] = {'r2': r2, 'corr': corr, 'n': len(preds)}
    print(f"{stat:<12}{'derived':<9}{r2 if r2 is not None else '--':>8}{corr if corr is not None else '--':>8}{len(preds):>6}")

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w') as f: json.dump(output, f, indent=2)
print(f'\nWrote fantasy-peak-regression.json')
