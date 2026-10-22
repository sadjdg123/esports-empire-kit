# Dev helper: coordinate search over tactic knobs toward a target tactic matrix.
# Usage: python3 tools/dev/search.py <evals> <n>
import json, subprocess, sys, re, copy, os
P = 'src/data/match.json'
EVALS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
N = sys.argv[2] if len(sys.argv) > 2 else '150'
NAMES = {'前期猛攻': 'EA', '稳健运营': 'SM', '团战推进': 'TFP', '分带牵制': 'SP'}
TARGET = {('EA','SM'): 0.42, ('EA','TFP'): 0.60, ('EA','SP'): 0.50, ('SM','TFP'): 0.50, ('SM','SP'): 0.40, ('TFP','SP'): 0.60}
KNOBS = [  # (path, step, lo, hi)
  ('tactics.EARLY_AGGRO.powerCurve.0.damage', 0.03, 1.0, 1.25),
  ('tactics.EARLY_AGGRO.powerCurve.1.damage', 0.03, 0.85, 1.0),
  ('tactics.STEADY_MACRO.powerCurve.1.damage', 0.03, 1.0, 1.2),
  ('tactics.STEADY_MACRO.farmGold', 0.04, 1.0, 1.25),
  ('tactics.TEAMFIGHT_PUSH.siegeDamage', 0.1, 1.0, 1.6),
  ('tactics.TEAMFIGHT_PUSH.powerCurve.0.damage', 0.03, 0.85, 1.05),
  ('tactics.SPLIT_PUSH.rules.0.factor', 0.2, 1.0, 2.6),
  ('tactics.SPLIT_PUSH.rules.1.factor', 0.15, 0.8, 1.8),
]
def get(m, path):
  for k in path.split('.'): m = m[int(k)] if k.isdigit() else m[k]
  return m
def put(m, path, v):
  ks = path.split('.')
  for k in ks[:-1]: m = m[int(k)] if k.isdigit() else m[k]
  last = ks[-1]
  if last.isdigit(): m[int(last)] = v
  else: m[last] = v
def evaluate(m):
  json.dump(m, open(P, 'w'), ensure_ascii=False, indent=2)
  out = subprocess.run(['npx', 'tsx', 'tools/sim-cli.ts', '--n', N, '--only', 'G4'], capture_output=True, text=True, env={**os.environ, 'BALANCE_DEBUG': '1'}).stdout
  res = {}
  for line in out.splitlines():
    mm = re.match(r'- (\S+) vs (\S+): win ([\d.]+)%', line)
    if mm: res[(NAMES[mm.group(1)], NAMES[mm.group(2)])] = float(mm.group(3)) / 100
  dur = re.search(r'中位数 ([\d.]+) 分钟', out)
  loss = sum((res[k] - v) ** 2 for k, v in TARGET.items())
  # dominance penalty
  return loss, res, float(dur.group(1)) if dur else 0
base = json.load(open(P))
# ensure TFP has an early tempo window to tune
if not base['tactics']['TEAMFIGHT_PUSH']['powerCurve']:
  base['tactics']['TEAMFIGHT_PUSH']['powerCurve'] = [{'toSec': 720, 'damage': 0.97}]
best = copy.deepcopy(base)
bl, br, bd = evaluate(best)
print('start', round(bl, 4), {f'{a}-{b}': round(v, 2) for (a, b), v in br.items()}, bd, flush=True)
evals = 1
improved = True
while evals < EVALS and improved:
  improved = False
  for path, step, lo, hi in KNOBS:
    if evals >= EVALS: break
    cur = get(best, path)
    for sgn in (1, -1):
      v = round(min(hi, max(lo, cur + sgn * step)), 3)
      if v == cur: continue
      cand = copy.deepcopy(best); put(cand, path, v)
      l, r, d = evaluate(cand); evals += 1
      print(f'{evals:3d} {path}={v} loss={l:.4f}', {f'{a}-{b}': round(x, 2) for (a, b), x in r.items()}, d, flush=True)
      if l < bl:
        best, bl, br = cand, l, r; improved = True
        break
json.dump(best, open(P, 'w'), ensure_ascii=False, indent=2)
print('best', round(bl, 4), {f'{a}-{b}': round(v, 2) for (a, b), v in br.items()})
