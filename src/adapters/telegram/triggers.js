/** Telegram offsets use UTF-16 units, exactly like JavaScript string indices. */
export function extractTrigger(message, identity) {
  const text = message.text || message.caption || '';
  const entities = message.text ? message.entities || [] : message.caption_entities || [];
  const tag = identity.username ? `@${identity.username.toLowerCase()}` : '';
  const strips = [];
  let mentioned = false,
    foreignCommand = false;
  for (const entity of entities) {
    const { offset, length } = entity;
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset + length > text.length
    )
      continue;
    const value = text.slice(offset, offset + length);
    if (
      (entity.type === 'mention' && tag && value.toLowerCase() === tag) ||
      (entity.type === 'text_mention' &&
        Number.isSafeInteger(identity.id) &&
        entity.user?.id === identity.id)
    ) {
      mentioned = true;
      strips.push({ start: offset, end: offset + length });
    }
    if (entity.type === 'bot_command') {
      const at = value.lastIndexOf('@');
      if (at >= 0) {
        if (tag && value.slice(at).toLowerCase() === tag) {
          mentioned = true;
          strips.push({ start: offset + at, end: offset + length });
        } else if (offset === 0) foreignCommand = true;
      }
    }
  }
  // Also reject an explicitly addressed foreign slash command if entities are absent.
  const commandTarget = /^\/[a-z]+(@[a-z0-9_]+)(?:\s|$)/i.exec(text)?.[1];
  if (commandTarget && commandTarget.toLowerCase() !== tag) foreignCommand = true;
  let cleaned = '',
    cursor = 0;
  for (const strip of strips.sort((a, b) => a.start - b.start)) {
    if (strip.start < cursor) continue;
    cleaned += text.slice(cursor, strip.start);
    cursor = strip.end;
  }
  cleaned += text.slice(cursor);
  return {
    text: cleaned.trim(),
    mentioned,
    foreignCommand,
    repliedToBot:
      Number.isSafeInteger(identity.id) && message.reply_to_message?.from?.id === identity.id,
  };
}
