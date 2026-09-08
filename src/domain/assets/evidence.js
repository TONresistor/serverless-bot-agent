import { Address, Cell } from '@ton/core';

export function sameAddress(left, right) {
  try {
    return Address.parse(left).equals(Address.parse(right));
  } catch {
    return false;
  }
}

export function bodyHash(bodyBoc) {
  try {
    return Cell.fromBase64(bodyBoc).hash().toString('hex');
  } catch {
    return null;
  }
}

export function matchingOrigin(plan, evidence) {
  const hash = bodyHash(plan.message.bodyBoc);
  return (evidence?.nodes || []).find(
    (node) =>
      sameAddress(node.address, plan.message.destination) &&
      node.in &&
      !node.in.bounced &&
      sameAddress(node.in.source, plan.receipt.wallet) &&
      sameAddress(node.in.destination, plan.message.destination) &&
      node.in.valueNano === plan.message.amountNano &&
      hash &&
      bodyHash(node.in.bodyBoc) === hash,
  );
}

/** Match the actual emitted internal message, not an unrelated wallet delta. */
export function emittedReceipt(message, nodes) {
  const hash = bodyHash(message.bodyBoc);
  if (!hash || !message.createdLt) return null;
  return nodes.find(
    (node) =>
      sameAddress(node.address, message.destination) &&
      node.in &&
      !node.in.bounced &&
      sameAddress(node.in.source, message.source) &&
      sameAddress(node.in.destination, message.destination) &&
      node.in.createdLt === message.createdLt &&
      node.in.valueNano === message.valueNano &&
      bodyHash(node.in.bodyBoc) === hash,
  );
}
