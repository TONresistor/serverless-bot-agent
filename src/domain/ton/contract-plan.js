import { Cell } from '@ton/core';
import { AgentError } from '../../shared/errors.js';
import { parseDestination } from '../wallet.js';

export function validateContractPlan(plan, network) {
  if (
    !plan ||
    typeof plan.summary !== 'string' ||
    !plan.summary.trim() ||
    plan.summary.length > 7000 ||
    !plan.message ||
    !plan.receipt
  )
    throw new AgentError('invalid_plan', 'The operation could not be prepared.');
  plan = JSON.parse(JSON.stringify(plan));
  plan.message.destination = parseDestination(plan.message.destination, network).raw;
  if (
    !/^\d{1,36}$/.test(plan.message.amountNano) ||
    BigInt(plan.message.amountNano) <= 0n ||
    plan.message.bounce !== true ||
    typeof plan.message.bodyBoc !== 'string' ||
    plan.message.bodyBoc.length > 65536
  )
    throw new AgentError('invalid_plan', 'Invalid contract message.');
  try {
    Cell.fromBase64(plan.message.bodyBoc);
  } catch {
    throw new AgentError('invalid_plan', 'Invalid contract payload.');
  }
  return plan;
}
