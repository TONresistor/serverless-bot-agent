import { Cell, TupleReader } from '@ton/core';
import { AgentError } from '../../shared/errors.js';

export function encodeStack(items) {
  return items.map((item) => {
    if (item.type === 'int') return ['num', item.value.toString()];
    const type = { cell: 'tvm.Cell', slice: 'tvm.Slice', builder: 'tvm.Builder' }[item.type];
    if (type && item.cell instanceof Cell) return [type, item.cell.toBoc().toString('base64')];
    throw new AgentError('ton_stack', 'Unsupported getter argument.');
  });
}
function integer(value) {
  if (typeof value !== 'string' || !/^-?(?:0x[\da-f]+|\d+)$/i.test(value))
    throw new Error('Invalid integer');
  return value.startsWith('-') ? -BigInt(value.slice(1)) : BigInt(value);
}
function item(value, depth = 0) {
  if (depth > 32) throw new Error('Tuple nesting');
  if (Array.isArray(value)) {
    const [type, data] = value;
    if (type === 'num') return { type: 'int', value: integer(data) };
    if (type === 'null') return { type: 'null' };
    if (['cell', 'slice', 'builder'].includes(type))
      return { type, cell: Cell.fromBase64(typeof data === 'string' ? data : data.bytes) };
    if (['tuple', 'list'].includes(type))
      return { type: 'tuple', items: (data?.elements || []).map((v) => item(v, depth + 1)) };
  } else if (value && typeof value === 'object') {
    const type = value['@type'];
    if (type === 'tvm.numberDecimal') return { type: 'int', value: integer(value.number) };
    if (type === 'tvm.cell' || type === 'tvm.slice')
      return { type: type.slice(4), cell: Cell.fromBase64(value.bytes) };
    if (type === 'tvm.tuple' || type === 'tvm.list')
      return { type: 'tuple', items: value.elements.map((v) => item(v, depth + 1)) };
    const child = {
      'tvm.stackEntryNumber': 'number',
      'tvm.stackEntryCell': 'cell',
      'tvm.stackEntrySlice': 'slice',
      'tvm.stackEntryTuple': 'tuple',
      'tvm.stackEntryList': 'list',
    }[type];
    if (child) return item(value[child], depth + 1);
  }
  throw new Error('Invalid stack item');
}
export function decodeStack(raw) {
  try {
    if (!Array.isArray(raw)) throw new Error();
    return new TupleReader(
      /** @type {import('@ton/core').TupleItem[]} */ (raw.map((v) => item(v))),
    );
  } catch {
    throw new AgentError('ton_stack', 'The network returned an invalid getter stack.');
  }
}
