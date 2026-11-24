"""The policy and value network: a small convolutional reader of the local grid,
joined with the character's own state. No memory: it acts on what it sees now."""

import torch
import torch.nn as nn


class ActorCritic(nn.Module):
    def __init__(self, channels: int, side: int, self_size: int, actions: int, width: int = 256):
        super().__init__()
        self.grid = nn.Sequential(
            nn.Conv2d(channels, 32, 3, padding=1), nn.ReLU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1), nn.ReLU(),
            nn.Conv2d(64, 64, 3, stride=2, padding=1), nn.ReLU(),
            nn.Flatten(),
        )
        reduced = (side + 1) // 2
        reduced = (reduced + 1) // 2
        self.own = nn.Sequential(nn.Linear(self_size, 64), nn.ReLU())
        self.body = nn.Sequential(nn.Linear(64 * reduced * reduced + 64, width), nn.ReLU())
        self.policy = nn.Linear(width, actions)
        self.value = nn.Linear(width, 1)
        nn.init.orthogonal_(self.policy.weight, 0.01)
        nn.init.orthogonal_(self.value.weight, 1.0)

    def forward(self, grid, own, mask):
        hidden = self.body(torch.cat([self.grid(grid), self.own(own)], dim=1))
        # An action the environment would drop is never offered.
        logits = self.policy(hidden).masked_fill(mask == 0, -1e9)
        return logits, self.value(hidden).squeeze(-1)
