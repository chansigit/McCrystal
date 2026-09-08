// Moving one item between two of a character's grids.
//
// The vault, the trade window and the refine window all work the same way on the server:
// PlayerObject.StoreItem, DepositTradeItem and DepositRefineItem each take a From in one
// grid and a To in the other, fill the target only if they find it empty, and answer with
// the same From, To and a bare Success. None of them swaps and none of them merges.
//
// Nothing is applied before the answer arrives, so a refusal reverts to itself: both grids
// still hold what the server holds. What is left is the case where the answer cannot be
// applied -- a slot that is out of range, a source that is empty, a target that is not --
// and that means the two sides have already diverged. Silently ignoring it would leave the
// player dragging items that are not there, so it throws and the panel says to reload.

export function firstEmptySlot(grid, limit = Infinity) {
  if (!grid) return -1;
  for (let index = 0; index < Math.min(grid.length, limit); index++) if (!grid[index]) return index;
  return -1;
}

/// <summary>Applies an accepted transfer, or throws if it cannot be applied.</summary>
export function applyGridMove(source, target, from, to, desync) {
  if (!Number.isInteger(from) || from < 0 || from >= source.length ||
      !Number.isInteger(to) || to < 0 || to >= target.length)
    throw new Error(desync.slot);
  if (!source[from]) throw new Error(desync.source);
  if (target[to]) throw new Error(desync.target);
  target[to] = source[from];
  source[from] = null;
}
