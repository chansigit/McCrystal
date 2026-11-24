"""PPO on the Bichon world for the network with memory (see mccrystal/model_mem.py),
with collecting and learning running at the same time.

The network carries a state from one decision to the next, so it is trained on short
runs of consecutive decisions ("chunks" of --chunk steps) rather than on single ones:
each chunk starts from the state the actor had at that moment and the state is
carried through it. Each character also keeps a map of its own, updated every step.

    PYTHONPATH=python .venv/bin/python python/train_ppo.py --name first --minutes 30

Several worlds run side by side, each with its own characters; together they are one
batch. The world never ends, so there are no episodes: a rollout is cut off wherever
it is and the value of the last state stands in for the rest.

Two threads share the work. The actor steps the worlds without pause, choosing
actions with a copy of the network, and fills one rollout after another. The learner
takes each finished rollout and updates the network on it while the actor is already
filling the next. So the worlds never wait for an update and the update never waits
for the worlds; with two GPUs each thread has its own. The price is that a rollout
was collected by the network as it stood one update earlier, which PPO's ratio to the
recorded action probabilities accounts for.

Reward per step, from the differences of the running totals the environment reports:
    level_weight * (level gained, with progress)  +  hit_weight * (blows landed)
    + gold_weight * (gold picked up or earned)  -  death_weight * (deaths)
"""

import argparse
import csv
import json
import queue
import threading
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from mccrystal import CrystalWorlds, Stat
from mccrystal.memory import LAYERS, SIZE, MapMemory
from mccrystal.model_mem import RecurrentActorCritic

p = argparse.ArgumentParser()
p.add_argument("--name", default="run")
p.add_argument("--worlds", type=int, default=6)
p.add_argument("--agents", type=int, default=64)
p.add_argument("--seed", type=int, default=1)
p.add_argument("--rollout", type=int, default=128)
p.add_argument("--chunk", type=int, default=16, help="consecutive decisions trained on together; must divide the rollout")
p.add_argument("--no-map", action="store_true", help="leave each character's own map blank: short memory only")
p.add_argument("--minutes", type=float, default=30, help="wall-clock budget")
p.add_argument("--epochs", type=int, default=2)
p.add_argument("--minibatch-size", type=int, default=32768, help="samples per optimiser step, as near as divides the batch")
p.add_argument("--lr", type=float, default=3e-4)
p.add_argument("--gamma", type=float, default=0.998)
p.add_argument("--lam", type=float, default=0.95)
p.add_argument("--clip", type=float, default=0.2)
p.add_argument("--entropy", type=float, default=0.01)
p.add_argument("--value-weight", type=float, default=0.5)
p.add_argument("--level-weight", type=float, default=10.0)
p.add_argument("--hit-weight", type=float, default=0.1)
p.add_argument("--death-weight", type=float, default=0.5)
p.add_argument("--gold-weight", type=float, default=0.002, help="per gold picked up or earned")
p.add_argument("--life-hours", type=float, default=6, help="game hours before a world starts over with new characters")
p.add_argument("--device", default="auto", help="where the network is updated")
p.add_argument("--actor-device", default="auto", help="where actions are chosen; another GPU if there is one")
p.add_argument("--resume", default=None)
args = p.parse_args()

if args.device == "auto":
    gpus = torch.cuda.device_count() if torch.cuda.is_available() else 0
    args.device = "cuda:1" if gpus > 1 else "cuda:0" if gpus == 1 else "mps" if torch.backends.mps.is_available() else "cpu"
if args.actor_device == "auto":
    args.actor_device = "cuda:0" if args.device == "cuda:1" else args.device
learn_device, act_device = torch.device(args.device), torch.device(args.actor_device)
torch.manual_seed(args.seed)
# The CPU-side tensor work here is small. Left at one thread per core, PyTorch spends far
# longer waking its threads on a busy machine than doing the work (measured: 160 ms against under 1 ms).
torch.set_num_threads(8)
if learn_device.type == "cuda":
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True


def amp(device):
    # Half-width arithmetic for the convolutions; the heads and the losses stay in float32.
    return torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda")


def build(device):
    made = RecurrentActorCritic(env.channels, env.side, env.self_size, env.num_actions).to(device)
    return made.to(memory_format=torch.channels_last) if device.type == "cuda" else made


class Rollout:
    """One rollout, held on a device. The grid, by far the largest part, is kept as
    bytes: its values are flags and fractions between 0 and 1."""

    def __init__(self, T, n, device):
        self.grid = torch.empty((T, n, env.channels, env.side, env.side), dtype=torch.uint8, device=device)
        self.own = torch.empty((T, n, env.self_size), device=device)
        self.mask = torch.empty((T, n, env.num_actions), dtype=torch.uint8, device=device)
        self.action = torch.empty((T, n), dtype=torch.long, device=device)
        self.log_prob = torch.empty((T, n), device=device)
        self.value = torch.empty((T + 1, n), device=device)
        self.reward = torch.empty((T, n), device=device)
        self.fresh = torch.empty((T, n), device=device)   # 1 where the step ended in a brand new world
        self.memory = torch.empty((T, n, LAYERS, SIZE, SIZE), dtype=torch.uint8, device=device)   # each character's map
        self.hidden = torch.empty((T // args.chunk, n, 256), device=device)   # the network's state at the start of each chunk

    def copy_from(self, other):
        for name, tensor in vars(self).items():
            tensor.copy_(getattr(other, name), non_blocking=True)


out = Path(__file__).resolve().parents[1] / "runs" / args.name
out.mkdir(parents=True, exist_ok=True)
(out / "args.json").write_text(json.dumps(vars(args), indent=1))


def reward_of(before, after):
    return (args.level_weight * (after[:, Stat.LEVEL] - before[:, Stat.LEVEL])
            + args.hit_weight * (after[:, Stat.HITS] - before[:, Stat.HITS])
            + args.gold_weight * (after[:, Stat.GOLD_GAINED] - before[:, Stat.GOLD_GAINED])
            - args.death_weight * (after[:, Stat.DEATHS] - before[:, Stat.DEATHS])).astype(np.float32)


life_steps = int(args.life_hours * 3600 / 0.2) if args.life_hours > 0 else None
with CrystalWorlds(args.worlds, args.agents, seed=args.seed, life_steps=life_steps) as env:
    n, T = env.num_envs, args.rollout
    assert T % args.chunk == 0, "--chunk must divide --rollout"
    net = build(learn_device)
    optimiser = torch.optim.Adam(net.parameters(), lr=args.lr, eps=1e-5)
    steps = 0
    if args.resume:
        saved = torch.load(args.resume, map_location=learn_device)
        if "net" in saved:
            net.load_state_dict(saved["net"]); optimiser.load_state_dict(saved["optimiser"]); steps = saved.get("steps", 0)
        else:
            net.load_state_dict(saved)

    def save():
        torch.save({"net": net.state_dict(), "optimiser": optimiser.state_dict(), "steps": steps, "arch": "memory-1", "map": not args.no_map}, out / "policy.pt")

    print(f"learning on {learn_device}, acting on {act_device}, {n} characters in {args.worlds} worlds, rollout {T}, "
          f"{sum(x.numel() for x in net.parameters()):,} parameters", flush=True)

    # ---- the actor ----

    actor_net = build(act_device)
    actor_net.load_state_dict(net.state_dict())
    actor_net.eval()
    weights = {"state": None}          # the learner's newest weights, for the actor to pick up
    weights_lock = threading.Lock()
    collecting = Rollout(T, n, act_device)
    finished = queue.Queue(maxsize=1)  # the actor says a rollout is ready and what happened in it
    taken = threading.Event()          # the learner says it has its copy
    stop = threading.Event()
    failure = []

    def act():
        try:
            obs, stats = env.reset()
            rewards = np.zeros((T, n), np.float32)
            fresh = np.zeros((T, n), np.float32)
            # The maps are kept on the CPU: many small updates, cheap there, and one upload per step.
            maps = MapMemory(n, "cpu")
            blank = torch.zeros((n, LAYERS, SIZE, SIZE), device=act_device)
            hidden = actor_net.initial(n, act_device)

            def remember(observation):
                if args.no_map:
                    return blank
                return maps.update(torch.from_numpy(observation["grid"]), torch.from_numpy(observation["self"]),
                                   torch.from_numpy(stats[:, Stat.DEATHS].astype(np.float32)),
                                   torch.from_numpy(stats[:, Stat.KILLS].astype(np.float32))).to(act_device, non_blocking=True)

            def see(observation):
                return (torch.from_numpy(observation["grid"]).to(act_device, non_blocking=True),
                        torch.from_numpy(observation["self"]).to(act_device, non_blocking=True),
                        torch.from_numpy(observation["mask"]).to(act_device, non_blocking=True))

            while not stop.is_set():
                with weights_lock:
                    state, weights["state"] = weights["state"], None
                if state is not None:
                    actor_net.load_state_dict(state)

                t_env = t_infer = 0.0
                first = stats.copy()
                for t in range(T):
                    a = time.perf_counter()
                    grid, own, mask = see(obs)
                    collecting.grid[t] = (grid * 255).round_().to(torch.uint8); collecting.own[t] = own; collecting.mask[t] = mask
                    memory = remember(obs)
                    collecting.memory[t] = (memory * 255).round_().to(torch.uint8)
                    if t % args.chunk == 0:
                        collecting.hidden[t // args.chunk] = hidden
                    with torch.no_grad(), amp(act_device):
                        logits, value, hidden = actor_net.step(grid, own, mask, memory, hidden)
                    dist = torch.distributions.Categorical(logits=logits.float())
                    action = dist.sample()
                    collecting.action[t] = action; collecting.log_prob[t] = dist.log_prob(action); collecting.value[t] = value.float()
                    chosen = action.cpu().numpy().astype(np.int32)   # waits for the device: counted as inference
                    b = time.perf_counter()
                    before = stats.copy()
                    obs, stats = env.step(chosen)
                    reward = reward_of(before, stats)
                    reward[env.fresh] = 0                      # totals of the old and the new world are unrelated
                    rewards[t] = reward; fresh[t] = env.fresh
                    if env.fresh.any():
                        first[env.fresh] = stats[env.fresh]
                        new = torch.from_numpy(env.fresh)                  # new characters: no state, a blank map
                        hidden = hidden * (~new).to(act_device).unsqueeze(1)
                        maps.forget(new)
                    c = time.perf_counter()
                    t_infer += b - a; t_env += c - b
                with torch.no_grad(), amp(act_device):
                    grid, own, mask = see(obs)
                    # A look ahead for the value only: the map and the state are not advanced.
                    collecting.value[T] = actor_net.step(grid, own, mask, blank if args.no_map else maps.map.to(act_device), hidden)[1].float()
                collecting.reward.copy_(torch.from_numpy(rewards)); collecting.fresh.copy_(torch.from_numpy(fresh))

                gained = stats - first
                hours = T * env.seconds_per_step / 3600 * n      # character-hours in this rollout
                finished.put({"env_s": t_env, "infer_s": t_infer, "reward": float(rewards.mean()),
                              "level": float(stats[:, Stat.LEVEL].mean()), "kills_per_h": gained[:, Stat.KILLS].sum() / hours,
                              "deaths_per_h": gained[:, Stat.DEATHS].sum() / hours, "hits_per_h": gained[:, Stat.HITS].sum() / hours})
                # Its buffer must stay as it is until the learner has copied it.
                while not taken.wait(0.5):
                    if stop.is_set(): return
                taken.clear()
        except Exception as error:  # surface it in the learner instead of dying silently
            failure.append(error)
            finished.put(None)

    actor = threading.Thread(target=act, name="actor", daemon=True)

    # ---- the learner ----

    data = Rollout(T, n, learn_device)
    log_file = open(out / "log.csv", "a", newline="", buffering=1)   # line by line, so a kill loses nothing
    log = csv.writer(log_file)
    log.writerow(["update", "steps", "wall_s", "game_h", "reward", "level", "kills_per_h", "deaths_per_h", "hits_per_h",
                  "policy_loss", "value_loss", "entropy", "sps", "env_s", "infer_s", "learn_s", "idle_s"])
    start = time.perf_counter()
    update, first_steps = 0, steps
    actor.start()

    while time.perf_counter() - start < args.minutes * 60:
        a = time.perf_counter()
        told = finished.get()
        if told is None:
            raise failure[0]
        data.copy_from(collecting)
        if learn_device.type == "cuda":
            torch.cuda.synchronize(learn_device)
        taken.set()
        idle = time.perf_counter() - a             # how long the learner had nothing to do
        update += 1
        steps += T * n

        # Generalised advantage estimation over a stream that never terminates.
        advantages = torch.empty((T, n), device=learn_device)
        running = torch.zeros(n, device=learn_device)
        for t in reversed(range(T)):
            keep = 1 - data.fresh[t]                   # nothing carries over into a new world
            delta = data.reward[t] + args.gamma * data.value[t + 1] * keep - data.value[t]
            running = delta + args.gamma * args.lam * keep * running
            advantages[t] = running
        returns = advantages + data.value[:T]

        a = time.perf_counter()
        L, K = args.chunk, T // args.chunk
        # A chunk is K-th part k of the rollout for character c. Indexing [k, :, c] of a
        # [K, L, n, ...] view picks whole chunks without rearranging the stored rollout.
        chunked = lambda x: x.view(K, L, n, *x.shape[2:])
        c_grid, c_own, c_mask, c_action = chunked(data.grid), chunked(data.own), chunked(data.mask), chunked(data.action)
        c_logp, c_adv, c_ret, c_memory = chunked(data.log_prob), chunked(advantages), chunked(returns), chunked(data.memory)
        # A new character starts at step t when the step before ended in a new world. Each
        # chunk's stored state already allows for that at its first step.
        starts = torch.zeros((T, n), device=learn_device)
        starts[1:] = data.fresh[:-1]
        c_starts = chunked(starts).clone()
        c_starts[:, 0] = 0
        chunks = K * n
        minibatches = max(1, round(T * n / args.minibatch_size))
        size = chunks // minibatches
        take = lambda x, k, c: x[k, :, c].transpose(0, 1)          # [L, B, ...]
        for _ in range(args.epochs):
            order = torch.randperm(chunks, device=learn_device)
            for m in range(minibatches):
                rows = order[m * size:(m + 1) * size]
                k, c = rows // n, rows % n
                with amp(learn_device):
                    logits, value = net.sequence(take(c_grid, k, c).float().div_(255), take(c_own, k, c), take(c_mask, k, c),
                                                 take(c_memory, k, c).float().div_(255), data.hidden[k, c], take(c_starts, k, c))
                dist = torch.distributions.Categorical(logits=logits.float())
                adv = take(c_adv, k, c).flatten()
                adv = (adv - adv.mean()) / (adv.std() + 1e-8)
                ratio = (dist.log_prob(take(c_action, k, c).flatten()) - take(c_logp, k, c).flatten()).exp()
                policy_loss = -torch.min(ratio * adv, ratio.clamp(1 - args.clip, 1 + args.clip) * adv).mean()
                value_loss = F.mse_loss(value.float(), take(c_ret, k, c).flatten())
                entropy = dist.entropy().mean()
                loss = policy_loss + args.value_weight * value_loss - args.entropy * entropy
                optimiser.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                optimiser.step()
        with weights_lock:
            weights["state"] = {name: tensor.detach().to(act_device, copy=True) for name, tensor in net.state_dict().items()}
        if learn_device.type == "cuda":
            torch.cuda.synchronize(learn_device)
        t_learn = time.perf_counter() - a

        wall = time.perf_counter() - start
        row = [update, steps, round(wall, 1), round(steps / n * env.seconds_per_step / 3600, 3), round(told["reward"], 5),
               round(told["level"], 3), round(told["kills_per_h"], 2), round(told["deaths_per_h"], 2), round(told["hits_per_h"], 1),
               round(policy_loss.item(), 4), round(value_loss.item(), 4), round(entropy.item(), 3), round((steps - first_steps) / wall),
               round(told["env_s"], 1), round(told["infer_s"], 1), round(t_learn, 1), round(idle, 1)]
        log.writerow(row)
        if update % 5 == 1:
            print(f"update {update:4d}  {steps/1e6:6.2f}M steps  {wall/60:5.1f} min  level {row[5]:.2f}  kills/h {row[6]:6.1f}  "
                  f"deaths/h {row[7]:5.2f}  reward {row[4]:.4f}  entropy {row[11]:.2f}  {row[12]:,} steps/s "
                  f"(collect: env {row[13]}s infer {row[14]}s | learn {row[15]}s, idle {row[16]}s)", flush=True)
        if update % 20 == 0:
            save()

    stop.set()
    taken.set()
    actor.join(timeout=60)
    save()
    print(f"saved {out / 'policy.pt'} after {steps:,} steps", flush=True)
