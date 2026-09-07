export function itemUseSound(packet, info) {
  if (!packet.Success || packet.Grid !== 1 || !info) return null;
  if (info.Type === 13 || info.Type === 27) return 10107;
  if (info.Type === 17) return 10118;
  return null;
}
export function itemGainSound(info) {
  return ({ 1: 10111, 2: 10112, 4: 10116, 5: 10115, 6: 10114, 7: 10113,
    10: 10117, 13: 10108 })[info?.Type] ?? 10118;
}
