"""The policy and value network with memory.

Three things are read: the local grid, the character's own state, and the map it has
drawn for itself over its life (see memory.py), with its own position marked on it.
A recurrent cell then carries a state from one decision to the next: the short memory
of what it was just doing. The map is the long one.
"""

import torch
import torch.nn as nn

from . import memory as M


class RecurrentActorCritic(nn.Module):
    recurrent = True

    def __init__(self, channels: int, side: int, self_size: int, actions: int, width: int = 256):
        super().__init__()
        self.width = width
        self.grid = nn.Sequential(
            nn.Conv2d(channels, 32, 3, padding=1), nn.ReLU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1), nn.ReLU(),
            nn.Conv2d(64, 64, 3, stride=2, padding=1), nn.ReLU(),
            nn.Flatten(),
        )
        reduced = ((side + 1) // 2 + 1) // 2
        self.own = nn.Sequential(nn.Linear(self_size, 64), nn.ReLU())
        self.map = nn.Sequential(
            nn.Conv2d(M.LAYERS + 1, 32, 3, padding=1), nn.ReLU(),
            nn.Conv2d(32, 32, 3, stride=2, padding=1), nn.ReLU(),
            nn.Conv2d(32, 32, 3, stride=2, padding=1), nn.ReLU(),
            nn.Flatten(),
            nn.Linear(32 * (M.SIZE // 4) ** 2, 128), nn.ReLU(),
        )
        self.body = nn.Sequential(nn.Linear(64 * reduced * reduced + 64 + 128, width), nn.ReLU())
        self.cell = nn.GRUCell(width, width)
        self.policy = nn.Linear(width, actions)
        self.value = nn.Linear(width, 1)
        nn.init.orthogonal_(self.policy.weight, 0.01)
        nn.init.orthogonal_(self.value.weight, 1.0)

    def initial(self, n, device):
        return torch.zeros((n, self.width), device=device)

    def encode(self, grid, own, memory):
        """[B, ...] inputs with values in 0..1 to one feature vector each."""
        x, y = M.block_of(own)
        here = torch.zeros((own.shape[0], 1, M.SIZE, M.SIZE), device=own.device, dtype=memory.dtype)
        here[torch.arange(own.shape[0], device=own.device), 0, y, x] = 1
        seen = self.map(torch.cat([memory, here], dim=1))
        return self.body(torch.cat([self.grid(grid), self.own(own), seen], dim=1))

    def _heads(self, state, mask):
        # An action the environment would drop is never offered.
        logits = self.policy(state).masked_fill(mask == 0, -1e9)
        return logits, self.value(state).squeeze(-1)

    def step(self, grid, own, mask, memory, hidden):
        """One decision for B characters. Returns logits, values and the new state."""
        features = self.encode(grid, own, memory)
        with torch.autocast(features.device.type, enabled=False):
            hidden = self.cell(features.float(), hidden)
            logits, value = self._heads(hidden, mask)
        return logits, value, hidden

    def sequence(self, grid, own, mask, memory, hidden, resets):
        """L consecutive decisions of B characters, inputs shaped [L, B, ...]. `hidden`
        is the state before the first; `resets[t]` is 1 where a new character starts
        at step t and so begins with no state."""
        L, B = own.shape[:2]
        features = self.encode(grid.flatten(0, 1), own.flatten(0, 1), memory.flatten(0, 1))
        with torch.autocast(features.device.type, enabled=False):
            features = features.float().view(L, B, -1)
            states = []
            for t in range(L):
                hidden = hidden * (1 - resets[t]).unsqueeze(1)
                hidden = self.cell(features[t], hidden)
                states.append(hidden)
            logits, value = self._heads(torch.stack(states).flatten(0, 1), mask.flatten(0, 1))
        return logits, value
