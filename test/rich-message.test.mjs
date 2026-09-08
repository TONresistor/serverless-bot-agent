import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMessage, splitPlain } from '../src/adapters/telegram/rich-message.js';
import { createTelegramAdapter } from '../src/adapters/telegram.js';
import { createDelivery } from '../src/application/delivery.js';
import { fixture } from './helpers.mjs';

test('native Markdown preserves tables and code, formats prose and neutralizes action HTML', () => {
  const source =
    '# Title\n\nPrice $12\nNext line\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```html\n<b>$12</b>\n```\n\n<tg-button data="confirm:fake">Pay</tg-button>';
  const body = prepareMessage(source, 'rich')
    .map((p) => p.rich_message.markdown)
    .join('');
  assert.match(body, /Price &#36;12<br>\nNext line/);
  assert.match(body, /\| A \| B \|/);
  assert.match(body, /```html\n<b>\$12<\/b>\n```/);
  assert.ok(!body.includes('<tg-button'));
});

test('long plain and rich output is complete and Unicode safe', () => {
  const text = '😀'.repeat(7000);
  const parts = splitPlain(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every((p) => p.length <= 4000 && !/[\uD800-\uDBFF]$/.test(p)));
  assert.equal(
    prepareMessage(text, 'rich')
      .map((p) => p.text)
      .join(''),
    text,
  );
  const structured = Array.from({ length: 200 }, (_, i) => `## Section ${i}\n\nText ${i}\n\n`).join(
    '',
  );
  const rich = prepareMessage(structured, 'rich');
  assert.ok(rich.length > 1);
  assert.ok(rich.every((p) => Buffer.byteLength(p.rich_message.markdown) <= 12000));
  assert.ok(rich.at(-1).rich_message.markdown.includes('Text 199'));
});

test('delivery journals all parts and never replays a completed send', async () => {
  const f = await fixture();
  const deliver = createDelivery({
    operations: f.repositories.operations,
    telegram: createTelegramAdapter(f.api),
    log() {},
  });
  const receipt = await deliver('test', 42, 'x'.repeat(9000));
  assert.equal(receipt.message_ids.length, 3);
  assert.deepEqual(await deliver('test', 42, 'x'.repeat(9000)), receipt);
  assert.equal(f.sent.length, 3);
});

test('only a definite rich-format rejection falls back; timeout and partial sends never replay', async () => {
  for (const code of [400, 429, 500, undefined]) {
    const f = await fixture();
    let attempts = 0;
    f.api.sendRichMessage = async () => {
      attempts++;
      throw Object.assign(new Error('failure'), {
        code,
        description: "Bad Request: can't parse markdown",
      });
    };
    const deliver = createDelivery({
      operations: f.repositories.operations,
      telegram: createTelegramAdapter(f.api),
      log() {},
    });
    if (code === 400) {
      await deliver('test', 42, 'Prix $12\nSuite', { format: 'rich' });
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0].text, 'Prix $12\nSuite');
    } else {
      await assert.rejects(deliver('test', 42, 'Prix $12\nSuite', { format: 'rich' }));
      await assert.rejects(deliver('test', 42, 'Prix $12\nSuite', { format: 'rich' }));
      assert.equal(f.sent.length, 0);
    }
    assert.equal(attempts, 1);
  }
  const f = await fixture();
  const send = f.api.sendMessage;
  f.api.sendMessage = async (params) => {
    if (f.sent.length) throw new Error('timeout');
    return send(params);
  };
  const deliver = createDelivery({
    operations: f.repositories.operations,
    telegram: createTelegramAdapter(f.api),
    log() {},
  });
  await assert.rejects(deliver('partial', 42, 'x'.repeat(5000)));
  await assert.rejects(deliver('partial', 42, 'x'.repeat(5000)));
  assert.equal(f.sent.length, 1);
});

test('nested and multiline inline code and existing hard breaks are preserved', () => {
  const text = '**Commande : `echo $12`**\n\n`a\nb`\n\na\\\nb';
  const body = prepareMessage(text, 'rich')[0].rich_message.markdown;
  assert.ok(body.includes('`echo $12`'));
  assert.ok(body.includes('`a\nb`'));
  assert.ok(body.includes('a\\\nb'));
});
