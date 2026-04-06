import json, os, glob, math
import numpy as np
from scipy.stats import pearsonr
from collections import defaultdict
from datetime import datetime

BASE = os.path.expanduser('~/Desktop/fantasy-baseball/data')
with open(os.path.join(BASE, 'players.json'), 'r') as f:
    players = json.load(f)

def get_age(dob_str, year):
    if not dob_str: return None
    try:
        dob = datetime.strptime(dob_str, '%Y-%m-%d')
        age = year - dob.year
        if (7, 1) < (dob.month, dob.day): age -= 1
        return age
    except: return None

history = defaultdict(list)
for path in glob.glob(os.path.join(BASE, 'history', '*.json')):
    filename = os.path.basename(path).replace('.json', '')
    if not filename.isdigit(): continue
    year = int(filename)
    with open(path, 'r') as f:
        data = json.load(f)
        for pid, seasons in data.items():
            if isinstance(seasons, list):
                for s in seasons:
                    if isinstance(s, dict):
                        s['year'] = year
                        history[pid].append(s)

stats_to_test = ['k_pct', 'bb_pct', 'iso']
results = {s: {'age_diffs': [], 'mlb_vals': []} for s in stats_to_test}

AVG_AGES = {'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0}

for pid, seasons in history.items():
    p = next((x for x in players.values() if str(x.get('mlbam_id')) == str(pid)), None)
    if not p or not p.get('birthDate'): continue
    
    mlb = [s for s in seasons if isinstance(s, dict) and s.get('level') == 'MLB']
    total_pa = sum(s.get('pa', 0) for s in mlb)
    if total_pa < 250: continue 
    
    total_ab = sum(s.get('ab', 0) for s in mlb) or 1
    total_h = sum(s.get('h', 0) for s in mlb)
    total_2b = sum(s.get('doubles', 0) or s.get('2b', 0) for s in mlb)
    total_3b = sum(s.get('triples', 0) or s.get('3b', 0) for s in mlb)
    total_hr = sum(s.get('hr', 0) for s in mlb)
    
    mlb_k = sum(s.get('so', 0) for s in mlb) / total_pa
    mlb_bb = sum(s.get('bb', 0) for s in mlb) / total_pa
    mlb_iso = ((total_h + total_2b + (total_3b * 2) + (total_hr * 3)) / total_ab) - (total_h / total_ab)

    milb = [s for s in seasons if isinstance(s, dict) and s.get('level') in AVG_AGES]
    for s in milb:
        lvl = s['level']
        pa = s.get('pa', 0)
        if pa < 100: continue
        
        age = get_age(p['birthDate'], s['year'])
        if age is None: continue
        age_diff = AVG_AGES[lvl] - age
        
        results['k_pct']['age_diffs'].append(age_diff)
        results['k_pct']['mlb_vals'].append(mlb_k)
        
        results['bb_pct']['age_diffs'].append(age_diff)
        results['bb_pct']['mlb_vals'].append(mlb_bb)
        
        results['iso']['age_diffs'].append(age_diff)
        results['iso']['mlb_vals'].append(mlb_iso)

print("\n=== CORRELATION ANALYSIS (MiLB Age Diff vs. MLB Stat Outcome) ===")
print("-" * 70)

for s, data in results.items():
    if len(data['age_diffs']) > 20:
        # Pearson R calculation
        corr, _ = pearsonr(data['age_diffs'], data['mlb_vals'])
        # Use .ljust() for Python string padding
        label = s.upper().ljust(7)
        print(f"Stat: {label} | Correlation with Age-Delta: {corr:+.3f}")
