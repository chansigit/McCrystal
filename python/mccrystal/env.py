"""A vectorised environment over one simulated world.

One server process runs one world; the N characters in it are the N parallel
environments. Observations, masks and actions live in a file both processes map
into memory, so a step copies nothing between them: the arrays this class returns
are views of that file and are overwritten by the next step. Copy what you keep.

The world is a continuing task. A character that dies is sent back to town by the
server and carries on; nothing is ever "done". How to cut the stream into episodes
and what to reward is the trainer's choice (see `Stat` for what there is to build
a reward from).
"""

from __future__ import annotations

import json
import mmap
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
# dotnet: $DOTNET, else the one on PATH, else the usual per-user and Homebrew places.
DOTNET = os.environ.get("DOTNET") or shutil.which("dotnet") or next(
    (path for path in (os.path.expanduser("~/.dotnet/dotnet"), "/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet")
     if os.path.exists(path)), "dotnet")


class Stat:
    """Columns of `CrystalVecEnv.stats`: running totals per character."""

    LEVEL = 0        # level plus progress to the next one: 9.40 is 40% of the way to 10
    EXPERIENCE = 1   # experience gained since the start
    DEATHS = 2
    KILLS = 3
    GOLD = 4         # gold held now
    HEALTH = 5       # 0..1
    GOLD_GAINED = 6  # gold picked up or earned since the start
    RELIEFS = 7      # starter weapons handed out by the environment
    HITS = 8         # blows that got through a monster's armour


class CrystalVecEnv:
    """
    obs:     dict(grid=float32[N, C, S, S], self=float32[N, F], mask=uint8[N, A])
    actions: int array [N], each in 0..A-1. An action whose mask bit is 0 is dropped.
    step():  returns (obs, stats) where stats is float64[N, 8], see `Stat`.
    """

    def __init__(
        self,
        agents: int = 100,
        seed: int = 1,
        pack: str | os.PathLike = REPO / "Packs" / "mir-176-bichon" / "pack.yaml",
        view_radius: int = 7,
        decision_ticks: int = 4,
        until_seconds: int | None = None,
        relief: bool = True,
        trace: str | os.PathLike | None = None,
        server_dir: str | os.PathLike = REPO / "Build" / "Server" / "Release",
        work_dir: str | os.PathLike | None = None,
        startup_timeout: float = 120.0,
    ):
        self._own_dir = work_dir is None
        self.work_dir = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="mccrystal-"))
        bridge_dir = self.work_dir / "bridge"
        if bridge_dir.exists():
            shutil.rmtree(bridge_dir)
        # A fresh state directory: the same seed then gives the same world.
        state_dir = self.work_dir / "state"
        if state_dir.exists():
            shutil.rmtree(state_dir)

        command = [
            DOTNET, "Server.Console.dll",
            "--pack", str(Path(pack).resolve()), "--state", str(state_dir),
            "--sim", "--sim-seed", str(seed), "--sim-agents", str(agents),
            "--sim-view", str(view_radius), "--sim-decision-ticks", str(decision_ticks),
            "--sim-policy", "remote", "--sim-remote", str(bridge_dir),
        ]
        if until_seconds:
            command += ["--sim-until", str(until_seconds)]
        if trace:
            command += ["--sim-trace", str(Path(trace).resolve())]
        if not relief:
            command += ["--sim-no-relief"]

        self.work_dir.mkdir(parents=True, exist_ok=True)
        self._log = open(self.work_dir / "server.log", "w")
        self._server = subprocess.Popen(command, cwd=server_dir, stdout=self._log, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL)

        description = bridge_dir / "bridge.json"
        deadline = time.monotonic() + startup_timeout
        while not description.exists():
            if self._server.poll() is not None:
                raise RuntimeError(f"The server exited with code {self._server.returncode} before the world was ready. "
                                   f"See {self.work_dir / 'server.log'}.")
            if time.monotonic() > deadline:
                self._server.kill()
                raise TimeoutError(f"The world was not ready after {startup_timeout:.0f} s. See {self.work_dir / 'server.log'}.")
            time.sleep(0.05)
        self.info = json.loads(description.read_text())

        self.num_envs = n = self.info["agents"]
        self.channels, self.side = self.info["channels"], self.info["side"]
        self.self_size, self.num_actions = self.info["self_size"], self.info["actions"]
        self.seconds_per_step = self.info["tick_ms"] * self.info["decision_ticks"] / 1000.0

        self._file = open(bridge_dir / self.info["shared"], "r+b")
        self._map = mmap.mmap(self._file.fileno(), self.info["size"])
        at = self.info["offsets"]
        self._header = np.frombuffer(self._map, np.int64, 2, at["header"])
        self.grid = np.frombuffer(self._map, np.float32, n * self.channels * self.side * self.side, at["grid"]).reshape(
            n, self.channels, self.side, self.side)
        self.self = np.frombuffer(self._map, np.float32, n * self.self_size, at["self"]).reshape(n, self.self_size)
        self.mask = np.frombuffer(self._map, np.uint8, n * self.num_actions, at["mask"]).reshape(n, self.num_actions)
        self.stats = np.frombuffer(self._map, np.float64, n * self.info["stat_count"], at["stats"]).reshape(n, -1)
        self._actions = np.frombuffer(self._map, np.int32, n, at["actions"])

        self._socket = socket.create_connection(("127.0.0.1", self.info["port"]))
        self._socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.closed = False
        self._waiting = False
        self._graceful = trace is not None
        self._ended = False

    # ---- the loop ----

    @property
    def step_count(self) -> int:
        return int(self._header[0])

    @property
    def game_seconds(self) -> float:
        return self._header[1] / 1000.0

    def _await_observation(self) -> bool:
        signal = self._socket.recv(1)
        if signal != b"S":  # b"E": the run reached its end; b"": the server has gone
            self._ended = signal == b"E"
            self.closed = True
            return False
        self._waiting = True
        return True

    def _obs(self):
        return {"grid": self.grid, "self": self.self, "mask": self.mask}

    def reset(self):
        """Waits for the first observation. The world itself is not rewound."""
        if not self._waiting and not self._await_observation():
            raise RuntimeError(f"The world ended before its first step. See {self.work_dir / 'server.log'}.")
        return self._obs(), self.stats

    def send(self, actions):
        """First half of a step: hands over the actions and returns at once."""
        if self.closed:
            raise RuntimeError("The world has ended.")
        if not self._waiting:
            self.reset()
        self._actions[:] = actions
        self._waiting = False
        self._socket.sendall(b"A")

    def receive(self):
        """Second half: waits for what the characters see next."""
        self._await_observation()
        return self._obs(), self.stats

    def step(self, actions):
        """Sends one action per character and waits for what they see next."""
        self.send(actions)
        return self.receive()

    def close(self):
        if getattr(self, "_socket", None) is not None:
            try:
                self._socket.sendall(b"Q")
            except OSError:
                pass
            self._socket.close()
            self._socket = None
        if getattr(self, "_server", None) is not None:
            # A server shutting down in good order waits several seconds for its
            # connections to drop. That only matters when it still has a trace to write
            # or has reached its own end; otherwise the world is thrown away, so stop it.
            if self._graceful or self._ended:
                try:
                    self._server.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    self._server.kill()
            else:
                self._server.kill()
                self._server.wait()
            self._server = None
        # The arrays are views of the map: let go of them before closing it.
        for name in ("_header", "grid", "self", "mask", "stats", "_actions"):
            if hasattr(self, name):
                delattr(self, name)
        if getattr(self, "_map", None) is not None:
            try:
                self._map.close()
            except BufferError:
                pass  # the caller still holds an array from a step
            self._file.close()
            self._map = None
        if getattr(self, "_log", None) is not None:
            self._log.close()
            self._log = None
        self.closed = True

    def remove_work_dir(self):
        """Deletes the state and log of a closed environment that made its own directory."""
        if self._own_dir and self.work_dir.exists():
            shutil.rmtree(self.work_dir, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class CrystalWorlds:
    """Several worlds side by side, seen as one batch: world w holds rows w*n .. (w+1)*n-1.

    Each world is its own server process, so they advance in parallel. Unlike a single
    world's arrays, the batch arrays here are copies, refreshed by every step.

    With `life_steps`, a world is replaced by a new one (new seed, new level 1
    characters) once it has run that many steps. The worlds start at staggered ages so
    the batch always holds characters at every stage of a life. `fresh` marks the rows
    that have just been replaced: what they did before has nothing to do with what
    they see now, so a trainer should not carry reward or value across.
    """

    def __init__(self, worlds: int, agents: int, seed: int = 1, life_steps: int | None = None, **options):
        self._agents, self._options, self._next_seed = agents, options, seed + worlds
        # Starting a world takes a few seconds, nearly all of it in the server: start them together.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(worlds, 16)) as pool:
            self.envs = list(pool.map(lambda w: CrystalVecEnv(agents=agents, seed=seed + w, **options), range(worlds)))
        self.life_steps = life_steps
        # World w is treated as already w/worlds of the way through its life.
        self._age = [(life_steps * w // worlds) if life_steps else 0 for w in range(worlds)]
        first = self.envs[0]
        self.agents_per_world = first.num_envs
        self.num_envs = worlds * first.num_envs
        self.channels, self.side, self.self_size, self.num_actions = first.channels, first.side, first.self_size, first.num_actions
        self.seconds_per_step = first.seconds_per_step
        n = self.num_envs
        self.grid = np.empty((n, self.channels, self.side, self.side), np.float32)
        self.self = np.empty((n, self.self_size), np.float32)
        self.mask = np.empty((n, self.num_actions), np.uint8)
        self.stats = np.empty((n, first.stats.shape[1]), np.float64)
        self.fresh = np.zeros(n, bool)
        self.restarts = 0

    def _gather(self):
        k = self.agents_per_world
        for w, env in enumerate(self.envs):
            rows = slice(w * k, (w + 1) * k)
            self.grid[rows], self.self[rows], self.mask[rows], self.stats[rows] = env.grid, env.self, env.mask, env.stats
        return {"grid": self.grid, "self": self.self, "mask": self.mask}, self.stats

    def reset(self):
        for env in self.envs:
            env.reset()
        return self._gather()

    def step(self, actions):
        k = self.agents_per_world
        self.fresh[:] = False
        for w, env in enumerate(self.envs):
            env.send(actions[w * k:(w + 1) * k])
        for w, env in enumerate(self.envs):
            env.receive()
            self._age[w] += 1
            if env.closed or (self.life_steps and self._age[w] >= self.life_steps):
                env.close()
                env.remove_work_dir()
                self.envs[w] = CrystalVecEnv(agents=self._agents, seed=self._next_seed, **self._options)
                self.envs[w].reset()
                self._next_seed += 1
                self._age[w] = 0
                self.fresh[w * k:(w + 1) * k] = True
                self.restarts += 1
        return self._gather()

    @property
    def closed(self):
        return False

    def close(self):
        for env in self.envs:
            env.close()
            env.remove_work_dir()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def random_actions(mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """One allowed action per row, uniformly among those the mask permits."""
    scores = rng.random(mask.shape, dtype=np.float32) * mask
    return scores.argmax(axis=1).astype(np.int32)
