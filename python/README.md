# Python 一侧的环境

`mccrystal.CrystalVecEnv` 启动一个服务端进程,把一个世界里的 N 个角色当成 N 个并行环境。只依赖 numpy。

```sh
# 先编译服务端,并用 Tools/PackTrim 生成 Packs/mir-176-bichon(见 docs/headless-sim-plan.md)
/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet build Server.Console/Server.Console.csproj -c Release
PYTHONPATH=python python3 python/bench.py --agents 100 --steps 20000
```

```python
from mccrystal import CrystalVecEnv, Stat

with CrystalVecEnv(agents=100, seed=1) as env:
    obs, stats = env.reset()
    for _ in range(1000):
        actions = my_policy(obs["grid"], obs["self"], obs["mask"])   # int[N]
        obs, stats = env.step(actions)
```

- `obs["grid"]` 是 `float32[N, 14, 15, 15]`,`obs["self"]` 是 `float32[N, 33]`,`obs["mask"]` 是 `uint8[N, 41]`。各字段的含义见 `docs/sim-interface.md`。
- `stats` 是 `float64[N, 9]`,每个角色的累计量(`Stat.LEVEL`、`EXPERIENCE`、`DEATHS`、`KILLS`、`GOLD`、`HEALTH`、`GOLD_GAINED`、`RELIEFS`、`HITS`)。奖励由训练代码用它们的差分自己组合。
- 这些数组是共享内存的视图,下一步会被覆盖。要留就 `.copy()`。
- 世界是连续任务:角色死了由服务端送回城继续,没有"结束"。怎么切分回合由训练代码决定。
- 每一步是 200ms 游戏时间(`decision_ticks` × 50ms)。世界会等 Python 给出动作,所以这个接口是给微秒级的策略用的,不是给 LLM 用的。
- 同一个种子、同一串动作,两次运行的观测逐字节相同。
- 要多个世界就开多个 `CrystalVecEnv`(各自一个进程),用不同的种子。

## 机制

服务端用 `--sim-policy remote --sim-remote 目录` 启动后,在那个目录里建一个内存映射文件 `shared.bin`,并写出 `bridge.json`(数组的形状、偏移和一个本机端口)。
每个决策步:服务端把观测、掩码、统计量写进共享文件,经本机连接发一个字节 `S`;Python 把动作写进共享文件,回一个字节 `A`。
Python 发 `Q` 或断开,服务端打印汇总后退出;服务端跑到 `--sim-until` 时发 `E`。实现在 `Server/MirEnvir/RemoteSimPolicy.cs`。

## 训练

```sh
sh python/setup_linux.sh                       # Linux:装 .NET 8(~/.dotnet)、编译服务端、建 .venv 并装 PyTorch
PYTHONPATH=python .venv/bin/python python/train_ppo.py --name first --minutes 30
PYTHONPATH=python .venv/bin/python python/eval_policy.py runs/first/policy.pt      # 100 角色、6 游戏小时、5 个种子,均值 ± 标准差
sh python/long_run.sh NAME --worlds 16         # 一直训练:每小时存一次并评测一次,结果追加到 runs/NAME/evals.txt;touch runs/NAME/stop 停止
```

- `train_ppo.py`:PPO,`--worlds` 个世界并行,每个世界 `--agents` 个角色。每个世界跑满 `--life-hours`(默认 6)游戏小时就换成新世界、新的一级角色,各世界的年龄错开。
- 奖励(每步,取累计量的差分):等级增量(含进度)× `--level-weight` + 打中怪的次数 × `--hit-weight` + 金币收入 × `--gold-weight` − 死亡次数 × `--death-weight`。
- 网络在 `mccrystal/model.py`:三层卷积读局部格子,与自身状态拼接;没有记忆。
- 脚本基线的参照值(同样口径,5 个种子):等级 10.19 ± 0.13,人均击杀 743 ± 27,人均死亡 1.32 ± 0.13。
