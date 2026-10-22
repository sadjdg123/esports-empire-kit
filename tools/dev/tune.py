# Dev helper: patch match.json with a JSON fragment (deep merge). Usage: python3 tools/dev/tune.py '<json>'
import json, sys
p = 'src/data/match.json'
m = json.load(open(p))
def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): merge(a[k], v)
        else: a[k] = v
merge(m, json.loads(sys.argv[1]))
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
