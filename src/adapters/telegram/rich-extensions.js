import { Lexer } from 'marked';

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(text) {
  const render = (token) => {
    if (token.type === 'codespan') return `<code>${escape(token.text)}</code>`;
    if (['strong', 'em', 'del'].includes(token.type)) {
      const tag = { strong: 'b', em: 'i', del: 's' }[token.type];
      return `<${tag}>${token.tokens.map(render).join('')}</${tag}>`;
    }
    if (token.type === 'link' && /^(https?:\/\/|tg:\/\/)/i.test(token.href))
      return `<a href="${escape(token.href)}">${token.tokens.map(render).join('')}</a>`;
    return escape(token.text || token.raw).replace(/\$(?=\d)/g, '&#36;');
  };
  return Lexer.lexInline(text).map(render).join('');
}
function cells(line) {
  line = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  const result = [];
  let cell = '',
    fence = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cell += '|';
      i++;
      continue;
    }
    if (line[i] === '`') {
      let n = 1;
      while (line[i + n] === '`') n++;
      if (!fence) fence = n;
      else if (fence === n) fence = 0;
      cell += '`'.repeat(n);
      i += n - 1;
      continue;
    }
    if (line[i] === '|' && !fence) {
      result.push(cell.trim());
      cell = '';
    } else cell += line[i];
  }
  result.push(cell.trim());
  return result;
}
export function expandCompactTables(text) {
  return text.replace(/<table\s+compact\s*>([\s\S]*?)<\/table>/gi, (whole, inner) => {
    if (/<tr[ >]/i.test(inner)) return whole;
    const rows = inner
      .trim()
      .split(/\r?\n/)
      .filter((r) => r.trim())
      .map(cells);
    if (
      rows.length < 2 ||
      rows[0].length !== rows[1].length ||
      rows[1].some((s) => !/^:?-{3,}:?$/.test(s)) ||
      rows.slice(2).some((r) => r.length > rows[0].length)
    )
      return inner.trim();
    const align = rows[1].map((s) =>
      s.startsWith(':') ? (s.endsWith(':') ? 'center' : 'left') : s.endsWith(':') ? 'right' : '',
    );
    const row = (items, tag) =>
      '<tr>' +
      rows[0]
        .map(
          (_, i) =>
            `<${tag}${align[i] ? ` align="${align[i]}"` : ''}>${inline(items[i] || '')}</${tag}>`,
        )
        .join('') +
      '</tr>';
    return (
      '<table compact>' +
      row(rows[0], 'th') +
      rows
        .slice(2)
        .map((r) => row(r, 'td'))
        .join('') +
      '</table>'
    );
  });
}

/** Exact presentation tags only; action controls and arbitrary attributes stay literal. */
export function safeRichHTML(text) {
  return text.replace(/(`+)[\s\S]*?\1|<(\/?[a-zA-Z][^>]*|!--[\s\S]*?--)>/g, (whole, code, tag) => {
    if (code) return whole;
    const allowed =
      /^(?:\/?(?:tg-spoiler|b|i|s|code|tr|table)|br\s*\/?|blockquote(?: expandable)?|\/blockquote|table compact|(?:th|td)(?: align="(?:left|right|center)")?|\/(?:th|td)|span class="tg-spoiler"|\/span|a href="(?:https?:\/\/|tg:\/\/)[^"<>]*"|\/a)$/i;
    return allowed.test(tag) ? whole : `&lt;${tag}&gt;`;
  });
}
