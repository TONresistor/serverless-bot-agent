import { createBuiltinRegistry } from '../../src/composition/tools.js';
// Compile-only contract assertions. This file is never executed or bundled.
import { createJettonInfoTool } from '../../src/tools/jetton/info.js';
import { createSwapTool } from '../../src/tools/swaps/swap.js';

/** @param {import('../../src/contracts/chain.js').ChainPort} chain
 * @param {import('../../src/contracts/finance.js').FinancialPreparation} finance
 * @param {import('../../src/contracts/persistence.js').OperationsRepository} operations
 * @param {import('../../src/contracts/finance.js').ContractPlan} plan
 * @param {Omit<import('../../src/contracts/capabilities.js').BuiltinPorts, 'transfers'>} partialPorts */
export function contractAssertions(chain, finance, operations, plan, partialPorts) {
  // @ts-expect-error The registry requires a transfer preparation capability.
  createBuiltinRegistry(partialPorts);
  chain.broadcast('unsigned-test-vector');
  // @ts-expect-error Broadcast accepts a serialized BOC string, not an amount.
  chain.broadcast(12);
  // @ts-expect-error Tools receive no wallet signer.
  finance.sign(plan);
  // @ts-expect-error There is no untyped catch-all on the chain capability.
  chain.getWalletData('address');
  // @ts-expect-error A transaction message amount must remain a decimal string.
  plan.message.amountNano = 123;
  // @ts-expect-error The operation journal requires a stable string identifier.
  operations.claim(123, 'tool');
  // @ts-expect-error Renaming a capability breaks the factory contract.
  createJettonInfoTool({ getJettonInfo: async () => ({}) });
  // @ts-expect-error Tool result must be a JSON object.
  createJettonInfoTool({ jettonInfo: async () => 'wrong result' });
  // @ts-expect-error The financial preparation capability is required.
  createSwapTool({ validate() {} });
}
