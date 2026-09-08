# 检查 monster-sprites.tsv 的内部一致性。
#
# 1.76 的 (Race, Appr) 决定一只怪长什么样：拿 247 个同名锚点验过，95 组里只有一组自相
# 矛盾（足球 / 黑色恶蛆，见 README）。所以同一组里出现两个 Image 就是一处错，而这类错
# 沉默——包能加载，服务端能跑，只是怪长错了样，要进游戏站到它跟前才看得出来。
import sqlite3, sys, collections

DB = 'ThirdParty/legend-176/snapshots/geem2-official-176/GEEM2.db'
TSV = 'Packs/mir-176/monster-sprites.tsv'
# 唯一已知的例外：两只都有同名记录，1.76 那行大概是借来占位的。
KNOWN = {(81, 74)}

db = sqlite3.connect(DB)
cols = [c[1] for c in db.execute('pragma table_info(Monster)')]
src = {}
for row in db.execute('select * from Monster'):
    d = dict(zip(cols, row))
    src[d['Name']] = d

pair, evidence = {}, {}
for line in open(TSV, encoding='utf-8'):
    if line.startswith('#') or not line.strip():
        continue
    f = (line.rstrip('\n').split('\t') + ['', '', ''])[:4]
    pair[f[0]], evidence[f[0]] = f[1], f[3]

problems = 0
for name in pair:
    if name not in src:
        print(f'不在 1.76 的 Monster 表里: {name}')
        problems += 1

groups = collections.defaultdict(lambda: collections.defaultdict(list))
for name, image in pair.items():
    if image and name in src:
        d = src[name]
        groups[(d['Race'], d['Appr'])][image].append(name)
for key, images in sorted(groups.items()):
    if len(images) > 1 and key not in KNOWN:
        problems += 1
        print(f'Race {key[0]} / Appr {key[1]} 同一个外观配了 {len(images)} 张图：')
        for image, names in images.items():
            print(f'  {image:>4}  ' + ', '.join(f'{n}[{evidence[n]}]' for n in names))

blank = [n for n, i in pair.items() if not i]
kinds = collections.Counter(e.split(':')[0] for e in evidence.values())
print(f'{len(pair)} 行，{len(blank)} 行留空（{", ".join(blank)}），'
      f'{len(groups)} 个 (Race, Appr) 组，{problems} 处问题')
print('依据分布: ' + '  '.join(f'{k}={v}' for k, v in kinds.most_common()))
sys.exit(1 if problems else 0)
