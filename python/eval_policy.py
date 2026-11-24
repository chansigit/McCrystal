"""Runs a trained policy the way the baselines were run: 100 characters, six game
hours, several seeds, and reports mean ± standard deviation over the seeds.

    PYTHONPATH=python .venv/bin/python python/eval_policy.py runs/ppo1/policy.pt --trace-dir runs/ppo1/traces
"""

import argparse
import statistics
from pathlib import Path

import numpy as np
import torch

from mccrystal import CrystalVecEnv, Stat
from mccrystal.model import ActorCritic

p = argparse.ArgumentParser()
p.add_argument("policy")
p.add_argument("--seeds", default="42,7,99,1,2")
p.add_argument("--agents", type=int, default=100)
p.add_argument("--hours", type=float, default=6)
p.add_argument("--trace-dir", default=None)
p.add_argument("--greedy", action="store_true", help="take the most likely action instead of sampling")
args = p.parse_args()

device = torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
seeds = [int(s) for s in args.seeds.split(",")]
seconds = int(args.hours * 3600)
envs = []
for seed in seeds:
    trace = str(Path(args.trace_dir) / f"seed{seed}.json") if args.trace_dir else None
    # The server stops itself at the exact tick, as the baseline runs did, and writes the trace then.
    envs.append(CrystalVecEnv(agents=args.agents, seed=seed, until_seconds=seconds, trace=trace))

first = envs[0]
net = ActorCritic(first.channels, first.side, first.self_size, first.num_actions).to(device)
saved = torch.load(args.policy, map_location=device)
net.load_state_dict(saved["net"] if "net" in saved else saved)
net.eval()
torch.manual_seed(0)

for env in envs:
    env.reset()
final = [None] * len(envs)
live = list(range(len(envs)))
while live:
    grid = torch.from_numpy(np.concatenate([envs[e].grid for e in live])).to(device)
    own = torch.from_numpy(np.concatenate([envs[e].self for e in live])).to(device)
    mask = torch.from_numpy(np.concatenate([envs[e].mask for e in live])).to(device)
    with torch.no_grad():
        logits, _ = net(grid, own, mask)
        action = logits.argmax(1) if args.greedy else torch.distributions.Categorical(logits=logits).sample()
    action = action.cpu().numpy().astype(np.int32)
    for k, e in enumerate(live):
        final[e] = envs[e].stats.copy()
        envs[e].send(action[k * args.agents:(k + 1) * args.agents])
    for e in list(live):
        envs[e].receive()
        if envs[e].closed:
            live.remove(e)
for env in envs:
    env.close()


def report(name, column, digits):
    values = [f[:, column].mean() for f in final]
    spread = statistics.stdev(values) if len(values) > 1 else 0.0
    print(f"{name}: {statistics.mean(values):.{digits}f} ± {spread:.{digits}f}")


if isinstance(saved, dict) and "steps" in saved:
    print(f"policy trained for {saved['steps']:,} steps")
print(f"{len(seeds)} seeds, {args.agents} characters, {args.hours:g} game hours, {'greedy' if args.greedy else 'sampled'} actions")
report("level, with progress", Stat.LEVEL, 2)
report("kills per character", Stat.KILLS, 0)
report("deaths per character", Stat.DEATHS, 2)
report("gold held per character", Stat.GOLD, 0)
print("lowest / highest level:", f"{min(int(f[:, Stat.LEVEL].min()) for f in final)} / {max(int(f[:, Stat.LEVEL].max()) for f in final)}")
