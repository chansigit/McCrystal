export function itemUseSound(packet, info) {
  if (!packet.Success || packet.Grid !== 1 || !info) return null;
  if (info.Type === 13 || info.Type === 27) return 10107;
  if (info.Type === 17) return 10118;
  return null;
}
