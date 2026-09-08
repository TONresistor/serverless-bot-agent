import { expandCompactTables, safeRichHTML } from './rich-extensions.js';
import { Lexer } from 'marked';
import { Buffer } from 'buffer';

const RICH_BYTES = 12_000;

/** Split plain text by UTF-16 units without cutting a surrogate pair. */
export function splitPlain(text, limit = 4000) {
  const chunks = [];
  let chunk = '';
  for (const character of text) {
    if (chunk.length + character.length > limit) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function paragraph(text) {
  function render(token) {
    if (['codespan', 'link', 'image', 'br'].includes(token.type)) return token.raw;
    if (token.tokens) {
      const inner = token.tokens.map((child) => child.raw).join('');
      return token.raw.replace(inner, () => token.tokens.map(render).join(''));
    }
    return token.raw.replace(/(?<!\\)\$(?=\d)/g, '&#36;').replace(/(?<! {2}|\\)\n/g, '<br>\n');
  }
  return Lexer.lexInline(text).map(render).join('');
}

/** Native GFM plus an exact allowlist of presentation HTML. */
export function prepareMessage(text, format = 'plain') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty Telegram message');
  if (format !== 'rich') return splitPlain(text).map((text) => ({ text }));
  const chunks = [];
  let markdown = '';
  let fallback = '';
  let lines = 0;
  const flush = () => {
    if (markdown.trim()) chunks.push({ rich_message: { markdown }, fallback_text: fallback });
    markdown = '';
    fallback = '';
    lines = 0;
  };
  // Presentation tags are allowed; model-authored action buttons remain escaped.
  const tokens = Lexer.lex(text, { gfm: true });
  // Reference definitions must remain available when a document is split.
  const definitions = tokens
    .filter((token) => token.type === 'def')
    .map((token) => token.raw)
    .join('\n');
  for (const token of tokens) {
    if (token.type === 'def') continue;
    const safe = token.type === 'code' ? token.raw : safeRichHTML(expandCompactTables(token.raw));
    const raw = token.type === 'paragraph' && !safe.includes('$$') ? paragraph(safe) : safe;
    const block = raw + (token.type === 'space' ? '' : '\n');
    const count = block.split('\n').length;
    // Oversized atomic blocks stay readable and complete as plain text. Never cut a table or fence.
    if (Buffer.byteLength(block + definitions) > RICH_BYTES || count > 100) {
      flush();
      chunks.push(
        ...splitPlain(token.raw)
          .filter((part) => part.trim())
          .map((text) => ({ text })),
      );
      continue;
    }
    if (Buffer.byteLength(markdown + block + definitions) > RICH_BYTES || lines + count > 100)
      flush();
    if (!markdown && definitions) {
      markdown = definitions + '\n';
      fallback = definitions + '\n';
    }
    markdown += block;
    fallback += token.raw;
    lines += count;
  }
  flush();
  return chunks.length ? chunks : splitPlain(text).map((text) => ({ text }));
}

/** Only a definitive content rejection permits a second transport attempt. */
export function isRichFormatRejection(error) {
  return (
    error?.code === 400 &&
    /(?:can't parse (?:entities|markdown)|invalid (?:markdown|rich message (?:content|block))|too many blocks|message is too long)/i.test(
      error.description || '',
    )
  );
}
