export function chatCommand(value, connected) {
  if (!connected) throw new Error("尚未连接到游戏，消息未发送");
  const message = value.trim();
  if (!message) return null;
  if (message.length > 80) throw new Error("消息不能超过 80 字符");
  return { Message: message, LinkedItems: [] };
}
