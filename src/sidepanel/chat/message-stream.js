// 与 Harness packages/shared/src/message-stream.ts 的流式增量语义保持一致。
export function applyMessageUpdate(previous, event) {
  if (event.stream !== "delta") return event.message;
  const seed = previous && previous.id === event.message.id ? previous : event.message;
  let content = seed.content ?? "";
  let thinking = seed.thinking ?? "";
  if (event.resetText) content = event.deltaText ?? "";
  else if (event.deltaText) content += event.deltaText;
  if (event.resetThinking) thinking = event.deltaThinking ?? "";
  else if (event.deltaThinking) thinking += event.deltaThinking;
  return {
    ...seed,
    id: event.message.id,
    role: event.message.role,
    createdAt: event.message.createdAt || seed.createdAt,
    status: event.message.status ?? seed.status,
    content,
    ...(thinking ? { thinking } : { thinking: undefined }),
    ...(event.message.modelId ? { modelId: event.message.modelId } : {}),
    ...(event.message.providerId ? { providerId: event.message.providerId } : {}),
    ...(event.message.parentToolCallId ? { parentToolCallId: event.message.parentToolCallId } : {}),
    ...(event.message.agentName ? { agentName: event.message.agentName } : {}),
    ...(event.message.hostedSearch ? { hostedSearch: event.message.hostedSearch } : seed.hostedSearch ? { hostedSearch: seed.hostedSearch } : {}),
  };
}
