import json
import os

path = os.path.expanduser('~/Desktop/fantasy-baseball/scripts/build-regression.py')
with open(path, 'r') as f:
    code = f.read()

# Replace the problematic json.dump line with a clean one that handles NaNs
old_line = 'json.dump(output, f, indent=2, allow_nan=False)'
new_line = 'json.dump(json.loads(json.dumps(output).replace("NaN", "null")), f, indent=2)'

# If the previous sed didn't hit, try the original version too
if old_line not in code:
    old_line = 'json.dump(output, f, indent=2)'

code = code.replace(old_line, new_line)

with open(path, 'w') as f:
    f.write(code)
