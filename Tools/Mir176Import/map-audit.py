"""Which of the pack's maps can a player actually reach?

The illusion floors were in the pack for weeks before anyone noticed them, because
nothing checks reachability: a map with a full spawn table and no way in imports
cleanly, validates cleanly and boots cleanly. This walks the world graph instead --
mapinfo.txt movements plus every MOVE in the pack's own NPC scripts -- from the towns
StartPoint.txt puts players in, and prints what it cannot get to.

Run from the repository root: python3 Tools/Mir176Import/map-audit.py

Two things this script got wrong first, both worth keeping in mind before believing it:
movement coordinates are written with spaces as well as commas, and the scripts must be
read from the *pack* (where MAPMOVE has been renamed MOVE), not from the 1.76 source.
"""
import re, os, glob, collections
S='ThirdParty/legend-176/snapshots/geem2-official-176'
def rd(p):
    return open(p, encoding='gbk', errors='replace').read().splitlines()

# --- mapinfo: declarations and movements ---
maps={}           # file -> title
order=[]
edges=collections.defaultdict(set)   # src file -> {dst file}
decl=re.compile(r'^\[(\S+)\s+(.*?)\s+\d+\]\s*(.*)$')
mov=re.compile(r'^(\S+)\s+(\d+)[\s,]+(\d+)\s*->\s*(\S+)\s+(\d+)[\s,]+(\d+)')  # 103 lines use spaces, not commas
for line in rd(f'{S}/Envir/mapinfo.txt'):
    t=line.strip()
    if not t or t.startswith(';'): continue
    m=decl.match(t)
    if m:
        f,title=m.group(1),m.group(2).strip()
        if f not in maps: maps[f]=title; order.append(f)
        continue
    m=mov.match(t)
    if m: edges[m.group(1)].add(m.group(4))

# --- mongen: spawns ---
spawn=collections.Counter()
for line in rd(f'{S}/Envir/mongen.txt'):
    t=line.strip()
    if not t or t.startswith(';'): continue
    p=t.split()
    if len(p)>=4: spawn[p[0]]+=1

# --- merchant.txt + Npcs.txt: NPC placements (only the imported ones) ---
npc=collections.Counter()
scripts=collections.defaultdict(set)   # map file -> {script id}
for name in ('merchant.txt','Npcs.txt'):
    path=f'{S}/Envir/{name}'
    if not os.path.exists(path): continue
    for line in rd(path):
        t=line.strip()
        if not t or t.startswith(';'): continue
        p=t.split()
        if len(p)>=4:
            npc[p[1]]+=1
            scripts[p[1]].add(p[0])

# --- script MOVE edges (act sections only) ---
def moves(lines):
    acting=False
    for raw in lines:
        l=raw.strip()
        if not l or l.startswith(';'): continue
        if l.startswith('[') and l.endswith(']'): acting=False; continue
        if l.startswith('#'):
            acting = l[1:].strip().split(' ')[0].upper() in ('ACT','ELSEACT'); continue
        if not acting: continue
        p=l.split()
        if len(p)>=2 and p[0].upper()=='MOVE': yield p[1]

# The pack's own scripts are what runs: UTF-8, and with M2's MAPMOVE/MAP already renamed to
# the engine's MOVE. Their file names are <scriptId>-<map>, which is also the only record of
# which map the NPC stands on.
script_edges=collections.defaultdict(set)
for path in glob.glob('Packs/mir-176/Envir/NPCs/*.txt'):
    base=os.path.splitext(os.path.basename(path))[0]
    if '-' not in base: continue
    home=base.rsplit('-',1)[1]
    lines=open(path,encoding='utf-8',errors='replace').read().splitlines()
    for dst in moves(lines):
        script_edges[home].add(dst)
        edges[home].add(dst)

# --- reachability from the towns players start in ---
starts=[f for f in ('0','1','2','3','4','5','6','7') if f in maps]
seen=set(); stack=list(starts)
while stack:
    cur=stack.pop()
    if cur in seen or cur not in maps: continue
    seen.add(cur)
    stack.extend(edges.get(cur,()))
print(f"declared maps: {len(maps)}   movements parsed: {sum(len(v) for v in edges.values())} distinct pairs   start set: {starts}")
print(f"reachable from the start towns: {len(seen)}")
unreach=[f for f in order if f not in seen]
print(f"unreachable: {len(unreach)}")
print()
print("== unreachable maps, with what is placed on them ==")
for f in unreach:
    into=[s for s,d in edges.items() if f in d]
    print(f"  {f:8} {maps[f][:16]:18} spawns={spawn[f]:4} npcs={npc[f]:3} inbound={len(into)}")
print()
print("== declared maps whose .map file is absent from the pack ==")
missing=[f for f in order if not os.path.exists(f'Packs/mir-176/Maps/{f}.map')]
print(f"  {len(missing)}: {missing}")
print()
print("== .map files in the snapshot that mapinfo never declares ==")
have={os.path.splitext(os.path.basename(p))[0] for p in glob.glob(f'{S}/Map/*.map')}
undeclared=sorted(have - set(maps))
print(f"  {len(undeclared)}")
print("  ", " ".join(undeclared))
