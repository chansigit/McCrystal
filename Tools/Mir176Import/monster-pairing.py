import sys, sqlite3, re, json, io, base64
sys.path.insert(0,'Tools/SpriteHD')
from PIL import Image
from mirlib import Library
S='/tmp/claude-501/-Users-chensijie-codes-Crystal/494da546-4002-4bff-b123-4fa2c1b7b28d/scratchpad'

# 没有排除名单。我对「什么算 1.76」判断错了三次（暗之系列、黄泉教主、重装使者、圣域
# 全都是 1.76），所以这个判断整个交给人：配了图的保留，没配的排除。

g=sqlite3.connect('ThirdParty/legend-176/snapshots/geem2-official-176/GEEM2.db')
x=sqlite3.connect('ThirdParty/legend-176/repos/crystalm2-176/ServerSqlite.db')
cols=[c[1] for c in x.execute('pragma table_info(MonsterInfo)')]
cm2={}
for r in x.execute('select * from MonsterInfo'):
    d=dict(zip(cols,r)); cm2.setdefault(d['Name'],d)
base=lambda n: re.sub(r'\d+$','',n)
cm2base={}
for n,d in cm2.items(): cm2base.setdefault(base(n),d)

lines=open('Shared/Enums.cs').read().split('\n')
i=next(j for j,l in enumerate(lines) if l.strip().startswith('public enum Monster : ushort'))
dep,body=0,[]
for l in lines[i:]:
    if '{' in l: dep+=l.count('{')
    if dep: body.append(l)
    if '}' in l:
        dep-=l.count('}')
        if dep==0 and body: break
v,ENUM=-1,{}
for line in body:
    line=line.split('//')[0].strip().rstrip(',')
    if not line or line in '{}': continue
    if '=' in line: n,xx=line.split('=',1); n=n.strip(); v=int(xx.strip(),0)
    else: n=line; v+=1
    ENUM[v]=n

mapped={}; event=[]; todo=[]
for name,race,lvl,exp,hp in g.execute('select Name,Race,Lvl,Exp,HP from Monster'):
    if name in cm2: mapped[name]=cm2[name]['Image']; continue
    if base(name) in cm2base: mapped[name]=cm2base[base(name)]['Image']; continue
    todo.append({'zh':name,'race':race,'lv':lvl,'hp':hp})
used=set(mapped.values())

proposals={'牛头魔':94,'牛魔战士':95,'牛魔斗士':96,'牛魔侍卫':97,'牛魔将军':98,'牛魔王':101,
 '半兽统领':126,'弓箭手':139,'石墓尸王':93,'骷髅锤兵':89,'地狱犬':148,
 # 攻城建筑是 1:1 的，不需要判断
 'SabukDoor':950,'SabukW':957}
exact={'SabukDoor':950,'SabukW1':957,'SabukW2':958,'SabukW3':959}
for t in todo: t['proposed']=exact.get(t['zh'], proposals.get(base(t['zh'])))

# 攻城建筑和宠物不在 Monster/ 下：Client/MirObjects/MonsterObject.cs:158-196 把
# 940-944 指到 Siege/、950-964 指到 Gate/、10000+ 指到 Pets/。只枚举 Monster/NNN.Lib
# 会整批漏掉沙巴克大门和城墙。
def libpath(img):
    if 940 <= img <= 944:   return f'Build/Client/Debug/Data/Siege/{img-940:02d}.Lib'
    if 950 <= img <= 964:   return f'Build/Client/Debug/Data/Gate/{img-950:02d}.Lib'
    if img >= 10000:        return f'Build/Client/Debug/Data/Pets/{img-10000:02d}.Lib'
    return f'Build/Client/Debug/Data/Monster/{img:03d}.Lib'

def thumb(img, px=92):
    try:
        a=Library(libpath(img)).rgba(0)
        if a is None: return None
        im=Image.fromarray(a,"RGBA"); im.thumbnail((px,px))
        b=io.BytesIO(); im.save(b,'PNG',compress_level=6)
        return "data:image/png;base64,"+base64.b64encode(b.getvalue()).decode()
    except Exception: return None
pool=[]
for v2 in sorted(ENUM):
    if v2 in used: continue
    t=thumb(v2)
    if t: pool.append({'id':v2,'name':ENUM[v2],'img':t})
json.dump({'todo':todo,'pool':pool,'event':event,'mapped':mapped},
          open(f'{S}/pair.json','w'), ensure_ascii=False)
print(f"自动配好 {len(mapped)}  排除(活动) {len(event)}  待配 {len(todo)}  可选贴图 {len(pool)}")
