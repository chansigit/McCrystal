# Headless MMO:开发计划与已定决策

2026-11-23 起草。分支 `headless-sim`。这份文件是给后续开发会话的交接:目标、已经定下的设计、开发阶段和已知的坑。
改动了设计或完成了阶段,就更新这里,不要另起文件。

## 目标

把 McCrystal 的服务端改造成 AI Agent 研究环境:无界面、虚拟时钟、可设种子、多世界并行,
Agent 通过宏指令参与游戏,真人仍可用原有客户端进入同一世界。正常模式和模拟模式共用同一套游戏逻辑。

当前阶段只做服务端,在本机(macOS)开发。

## 已定的设计决策

1. **世界不等 Agent。** 服务端按虚拟时钟连续推进,不做锁步。
2. **分层。**
   - 战略·慢思考:通用 LLM。决策模型置信度低时,以及需要生成文字时(聊天、谈判、长期计划)。
   - 战略·快决策:决策模型(Jev、Microsoft-Decision、pplx-decider 一类)。事件触发,从合法选项里选一条宏指令。
   - 战术:执行器,每个 tick 运行。先做脚本版,之后可换成 RL 策略(ONNX 进程内推理)。
   - 原子:现有游戏逻辑,原样复用。
3. **执行器在服务端进程内。** 它要在每个 tick 的固定位置按固定顺序运行,才能确定可复现。
   因此必须把 `PlayerObject` 和 TCP 连接拆开。
4. **两套接口。** 决策接口(宏指令下行;事件、状态摘要、合法选项上行)和控制接口(暂停、倍速、种子、重置、快照、全局统计)。
   都是独立通道,不加进游戏协议。
5. **不改 `Shared/` 里已有的封包和枚举。** 这样原生客户端和浏览器客户端都不用跟着改。
6. **倍速由谁在场决定。** 没有外部模型:越快越好。有决策模型或 LLM:中等固定倍速(用 LLM 时粗估 10 到 50 倍,未实测)。有真人:1 倍。
7. **多世界 = 多进程。** `Envir.Main` 是静态单例,`Settings` 全是静态字段,不做同进程多世界。
8. **快照分三档。** 先做指令日志重放,再做有损检查点(复用现有存盘),完整快照放最后。
9. **语言继续用 C#。**
10. **模拟模式默认不做定时自动存盘。** 只在三种时候存:关服时、控制接口显式要求时、可选的按真实时间间隔(给跑几天的 LLM 实验用)。
    模拟模式下跳过静态库 `SaveDB()` 和每次存盘的备份副本。正常模式(有真人)保留现有的自动存盘。存盘耗时未测,M0 时加计时日志。

## 开发阶段

| 阶段 | 做什么 | 验收标准 |
| --- | --- | --- |
| M0 基线 | 编译 `Server.Console`,用 `mir-176` 包启动,跑 `Tests/Regression` | 能启动,回归通过,记下循环耗时和内存 |
| M1 时钟抽象 | `Envir` 的时间来源改为可切换的时钟(真实 / 虚拟);清理逻辑里直接读系统时间的地方;加配置项 | 正常模式行为不变,回归通过 |
| M2 固定步长 | 模拟模式的主循环:每 tick 时钟前进固定值,处理完全部连接、对象、地图;关闭怪物多线程;倍速可设上限或不限 | 无玩家的世界连续跑几个虚拟小时;测出最高倍速和内存 |
| M3 确定性 | 每个世界一个可设种子的随机数实例;世界状态哈希(所有对象的位置和血量);排查其余不确定来源 | 同一种子跑两次,一个虚拟小时内哈希序列一致 |
| M4 无连接角色 | 把 `PlayerObject` 依赖的连接抽成接口;进程内 Agent 通道作为第二种实现;进程内直接生成角色的入口 | 生成 100 个不动的 Agent 角色,浏览器客户端能看到 |
| M5 脚本执行器 | 执行器接口,主循环每 tick 调用;宏指令:前往(含寻路)、区域打怪(含喝药、捡物)、待命 | 100 个 Agent 打怪一个虚拟小时,结果可复现;测出带 Agent 的倍速 |
| M6 控制和决策接口 | 扩展 `Server.Admin`:暂停、倍速、种子、重置、全局统计;决策网关(复用 `Envir.AdminActions` 队列);指令日志重放 | 外部脚本下宏指令能驱动 Agent;重放得到相同哈希 |

M2 是去留判断点:倍速太低就先优化广播和对象遍历。

### M0 结果(2026-11-23,本机 macOS ARM64)

- `Server.Console` 编译通过,0 个错误。`Tests/Regression` 37 项全过。
- 用 `mir-176` 包启动成功:386 张地图,加载约 7 秒,监听 7100 和 3100。
- 空服(无玩家)常驻内存约 1.5 到 1.7 GB,CPU 约 180%(主循环加一条怪物线程,都不休眠)。
- 没拿到的数:循环耗时。管理控制台端口被占,没读到概览页;存盘计时日志也还没加。留到 M1 一起做。
- **地图文件不在仓库里。** `Packs/mir-176/Maps/*.map` 被 `.gitignore` 排除(158 MB)。新机器上要先重建,见下面"本机运行"。
- **进程收不到停止信号。** 后台运行时 `SIGTERM` 不会让它退出,只能 `kill -9`,关服存盘因此不会执行。
  `Server.Console` 只处理了 Ctrl+C。上 Linux 用 systemd 之前要补上 `SIGTERM` 处理。

之后:更多宏指令(NPC 买卖、玩家交易、拍卖、行会、说话)、决策客户端和模型接入、RL 步进接口、快照、Linux 部署。

### M1 结果(2026-11-23)

- 新增 `Server/MirEnvir/GameClock.cs`:`RealClock`(正常模式)和 `VirtualClock`(只通过 `Advance` 前进)。
  `Envir.Clock` 在 `Start()` 里按配置选定,`Envir.Time` 改为从它读取。`Envir.Stopwatch` 保留,只用于真实时间的限额和性能测量。
- 新增 `Envir.LocalNow`,替换了行会领地租期里 5 处 `DateTime.Now`。正常模式下它就是系统时间,行为不变。
- 配置 `[Simulation] Enabled / TickMs / Speed`(`Speed` 还没生效)。`Server.Console --sim` 只对本次运行打开模拟模式,不写回 `Setup.ini`。
- 模拟模式下控制台每 5 秒打印一行 `[sim]`:虚拟时间、相对真实时间的倍速、怪物数、玩家数。
- 定时存盘加了计时(`Envir.LastSaveMilliseconds`,同时写一条 debug 日志)。还没读到实际数值,5 分钟才触发一次。
- `Server.Console` 现在响应 `SIGTERM`,后台运行也能正常关服存盘。
- 验证:编译 0 错误;回归 37/37;正常模式启动和关服正常;`--sim` 下虚拟时间在走,世界里有 54,022 只怪。
- **`--sim` 现在只能跑到 1.0 倍速。** 原因是怪物线程的截止时间用"虚拟时间 + 10"去和真实秒表比较,
  虚拟时间一旦超前,怪物线程就一直跑到真实时间追上来,把倍速锁死在 1。这正是 M2 要拆的东西:
  关掉怪物多线程,去掉对象遍历的 20ms 真实时间限额和连接的每毫秒限制。

## 已知的坑

- **存盘间隔跟着虚拟时间变快。** 每 5 分钟存一次,在 100 倍速下是每 3 秒全量写文件。模拟模式下改为按真实时间触发或关闭。
- **连接超时、IP 封禁等也会被加速。** 模拟模式下还有真实 TCP 连接时(如旁观客户端),这些判断要用真实时间。
- **主循环的两处真实时间限额。** 对象遍历每轮最多 20ms;连接每真实毫秒处理一次。固定步长下都要去掉。
- **随机数。** `RandomProvider` 的种子取自 `Environment.TickCount`,且是 `ThreadLocal`。
- **怪物多线程。** 多条怪物线程并发时,`Envir.Objects` 的增删和对象 ID 自增没有加锁。模拟模式下关闭。
- **拆连接的改动面。** 上游代码里 `PlayerObject` 有 31 处直接用连接对象,另有 600 多处发包调用;接口要设计成调用点不用改。
- **同一内容包开多个实例时端口冲突。** 端口写在包的 `Configs/Setup.ini` 里,`--state` 只分开了运行状态。
- **macOS 上 AirPlay 也占 7000 端口。** `mir-176` 用 7100,不受影响。见 `docs/project-status.md`。

## 代码入口(行号来自上游 Crystal,McCrystal 里略有偏移)

- 主循环:`Server/MirEnvir/Envir.cs` 的 `WorkLoop()`;逻辑时钟 `Time` 只在循环开头一处赋值。
- 怪物线程:同文件的 `ThreadLoop()`;对象入列在 `Server/MirObjects/MapObject.cs` 的 `Spawned()`。
- 管理动作队列:`Envir.AdminActions` / `ProcessAdminActions()`,主循环每轮开头清空。
- 连接和封包分发:`Server/MirNetwork/MirConnection.cs` 的 `Process()` / `ProcessPacket()`;角色在 `StartGame` 流程里创建。
- 地图处理和广播:`Server/MirEnvir/Map.cs` 的 `Process()`、`Broadcast()`。
- 存盘:`Envir.cs` 的 `BeginSaveAccounts()`、`SaveDB()`。
- 执行器的参考逻辑:`Tools/PyMirBot/examples/auto_fight.py`、`Tools/PyMirBot/mirbot/state.py`。

## 本机运行

第一次在一台机器上运行,要先重建地图(从 GPL-3.0 的 Mir2-GeeM2 仓库取 1.76 基线,再跑导入工具):

```sh
DOTNET=/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet
mkdir -p ThirdParty/legend-176/repos ThirdParty/legend-176/snapshots/geem2-official-176
git clone --filter=blob:none --no-checkout https://github.com/cjlaaa/Mir2-GeeM2 ThirdParty/legend-176/repos/mir2-geem2
git -C ThirdParty/legend-176/repos/mir2-geem2 archive 48bfebd | tar -x -C ThirdParty/legend-176/snapshots/geem2-official-176
$DOTNET run --project Tools/Mir176Import -- --source ThirdParty/legend-176/snapshots/geem2-official-176 \
    --pack Packs/mir-176/pack.yaml --report docs/reports/mir-176-import.md --write
```

导入工具重建出的 `Server.MirDB` 和仓库里提交的一致(`git status` 无变化)。之后每次:

```sh
$DOTNET build Server.Console/Server.Console.csproj
cd Build/Server/Debug
$DOTNET Server.Console.dll --pack ../../../Packs/mir-176/pack.yaml --state ../state-dev
```

`Build/` 被 `.gitignore` 排除,所以状态目录放在 `Build/Server/state-dev`。

`mir-176` 包的游戏端口是 7100,状态端口 3100。

## 未解决和待确认

- McCrystal 根目录没有 LICENSE 文件,README 徽章写 GPL v2;上游现在是服务端 GPL-3.0-only、客户端和 `Shared` MIT。公开前要对齐。
- `Packs/mir-176` 里的数据库、地图、脚本源自原版传奇,公开发布有版权风险。
- 单世界最高倍速、单世界内存占用:未测。
- 决策模型的延迟:厂商页面未给出。

## 相关页面

- 汇总文档:https://claude.ai/artifact/KWfJj6qDZ3uMPmyhZSY7cY
- 架构图:https://claude.ai/artifact/J96Rxnianjjxh1Rs8RmDxS
- Crystal 服务端流程图:https://claude.ai/artifact/WfU26ZQr4Yzznu5CA9ZL31
