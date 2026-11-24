"""A character's own map of the world, kept for its whole life.

The world is divided into SIZE x SIZE blocks. For every block the character keeps a
few numbers about what happened to it there. Nothing is ever erased: dying does not
clear it, only a new character starts with a blank map. (One layer, "lately", fades,
so that recent ground can be told from old.)

It is plain bookkeeping on what the character has itself observed, done here rather
than learned so that it cannot be forgotten. What to make of it is left to the network.
"""

import torch

SIZE = 16
VISITS, LATELY, STRONGEST, CROWD, DEATHS, KILLS, SHOP = range(7)
LAYERS = 7

# Where the character's position on the map sits in its own state vector (0..1 each).
SELF_X, SELF_Y = 14, 15
# Grid channels read here: a monster, its level / 50, and the three kinds of shop.
GRID_MONSTER, GRID_LEVEL, GRID_SHOPS = 2, 4, slice(9, 12)


def block_of(own):
    x = (own[:, SELF_X] * SIZE).long().clamp_(0, SIZE - 1)
    y = (own[:, SELF_Y] * SIZE).long().clamp_(0, SIZE - 1)
    return x, y


class MapMemory:
    def __init__(self, n, device):
        self.map = torch.zeros((n, LAYERS, SIZE, SIZE), device=device)
        self._rows = torch.arange(n, device=device)
        self._deaths = None
        self._kills = None
        self._last = None          # the block each character stood in one step ago

    def forget(self, rows):
        """New characters: `rows` is a boolean tensor, or None for everyone."""
        if rows is None:
            self.map.zero_()
            self._deaths = self._kills = self._last = None
        elif rows.any():
            self.map[rows] = 0
            if self._deaths is not None:
                self._deaths[rows] = 0
                self._kills[rows] = 0

    def update(self, grid, own, deaths, kills):
        """Call once per step, before the network looks. `deaths` and `kills` are the
        running totals of each character."""
        m, rows = self.map, self._rows
        x, y = block_of(own)
        if self._deaths is None:
            self._deaths, self._kills, self._last = deaths.clone(), kills.clone(), (x, y)

        m[:, LATELY] *= 0.999
        m[rows, LATELY, y, x] = 1
        m[rows, VISITS, y, x] = (m[rows, VISITS, y, x] + 0.005).clamp_(max=1)

        monsters = grid[:, GRID_MONSTER]
        strongest = (monsters * grid[:, GRID_LEVEL]).amax(dim=(1, 2))
        m[rows, STRONGEST, y, x] = torch.maximum(m[rows, STRONGEST, y, x], strongest)
        crowd = (monsters.sum(dim=(1, 2)) / 20).clamp_(max=1)
        m[rows, CROWD, y, x] = 0.95 * m[rows, CROWD, y, x] + 0.05 * crowd
        shop = (grid[:, GRID_SHOPS].amax(dim=(1, 2, 3)) > 0).float()
        m[rows, SHOP, y, x] = torch.maximum(m[rows, SHOP, y, x], shop)

        killed = (kills - self._kills).clamp_(min=0)
        m[rows, KILLS, y, x] = (m[rows, KILLS, y, x] + 0.02 * killed).clamp_(max=1)
        # By the time a death shows in the totals the character is back in town: it
        # died where it stood a step ago.
        died = (deaths - self._deaths) > 0
        if died.any():
            lx, ly = self._last
            at = rows[died]
            m[at, DEATHS, ly[died], lx[died]] = (m[at, DEATHS, ly[died], lx[died]] + 0.25).clamp_(max=1)

        self._deaths, self._kills, self._last = deaths.clone(), kills.clone(), (x, y)
        return m
