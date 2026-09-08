const escape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderButtons(buttons) {
  const inline = [],
    rows = new Map();
  for (const button of buttons) {
    const attr =
      button.type === 'url'
        ? `type="url" url="${escape(button.value)}"`
        : button.type === 'copy'
          ? `type="copy_text" text="${escape(button.value)}"`
          : button.type === 'callback'
            ? `type="callback_data" data="${escape(button.value)}"`
            : 'type="disabled"';
    const markup = `<tg-button ${attr}${button.style ? ` style="${escape(button.style)}"` : ''}>${escape(button.label)}</tg-button>`;
    if (
      button.placement === 'inline' ||
      ((!button.placement || button.placement === 'auto') && ['url', 'copy'].includes(button.type))
    )
      inline.push(markup);
    else {
      const row = button.row || 0;
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(markup);
    }
  }
  return [
    ...(inline.length ? [`<p>${inline.join(' ')}</p>`] : []),
    ...[...rows]
      .sort(([a], [b]) => a - b)
      .map(([, row]) => `<tg-button-row>${row.join('')}</tg-button-row>`),
  ].join('\n');
}
