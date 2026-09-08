import { digest } from '../shared/hash.js';

/** Cosmetic previews only. Native Stop is gated until Serverless forwards its event. */
export function createLiveProgress({ telegram, scope, event, now, assertActive }) {
  const enabled = scope.surface === 'dm' && !scope.editRef;
  const draftId = parseInt(digest(event).slice(0, 7), 16) || 1;
  let lastAt = -Infinity,
    lastText = '';
  return async (text) => {
    if (!enabled || text === lastText || now() - lastAt < 1200) return;
    await assertActive();
    lastAt = now();
    lastText = text;
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    try {
      await telegram.sendRichMessageDraft({
        chat_id: scope.destination,
        draft_id: draftId,
        rich_message: { html: `<tg-thinking>${escaped}</tg-thinking>` },
      });
    } catch {
      /* A failed preview must not fail the turn or retry a send. */
    }
  };
}
