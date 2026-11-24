"""Measures how many character-steps per second the bridge delivers.

    python3 python/bench.py --agents 100 --steps 20000

The policy is a random one that respects the mask, computed in numpy: it stands in
for a trainer that costs almost nothing, so the number is the ceiling the bridge
and the world set.
"""

import argparse
import time

import numpy as np

from mccrystal import CrystalVecEnv, Stat
from mccrystal.env import random_actions

parser = argparse.ArgumentParser()
parser.add_argument("--agents", type=int, default=100)
parser.add_argument("--steps", type=int, default=20000)
parser.add_argument("--seed", type=int, default=1)
parser.add_argument("--noop", action="store_true", help="send action 0 for everyone: the bridge and world alone")
args = parser.parse_args()

rng = np.random.default_rng(args.seed)
with CrystalVecEnv(agents=args.agents, seed=args.seed) as env:
    obs, stats = env.reset()
    zeros = np.zeros(env.num_envs, np.int32)
    policy_time = 0.0
    start = time.perf_counter()
    for _ in range(args.steps):
        t = time.perf_counter()
        actions = zeros if args.noop else random_actions(obs["mask"], rng)
        policy_time += time.perf_counter() - t
        obs, stats = env.step(actions)
    elapsed = time.perf_counter() - start

    game = args.steps * env.seconds_per_step
    print(f"agents {env.num_envs}, grid {env.grid.shape[1:]}, steps {args.steps}")
    print(f"wall {elapsed:.1f} s, of which the policy {policy_time:.1f} s")
    print(f"{args.steps / elapsed:,.0f} world steps/s, {args.steps * env.num_envs / elapsed:,.0f} character-steps/s, "
          f"{game / elapsed:,.0f}x real time")
    print(f"mean level {stats[:, Stat.LEVEL].mean():.2f}, kills {stats[:, Stat.KILLS].sum():.0f}, "
          f"deaths {stats[:, Stat.DEATHS].sum():.0f}, game time {env.game_seconds:.0f} s")
