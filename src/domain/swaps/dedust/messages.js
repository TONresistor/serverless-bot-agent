import { Address, beginCell } from '@ton/core';
import { VaultJetton } from '@dedust/sdk/dist/contracts/dex/vault/VaultJetton.js';
import { PayNative } from '@dedust/kit/dist/cpmm-v2/abi/messages/PayNative.js';
import { PayJetton } from '@dedust/kit/dist/cpmm-v2/abi/messages/PayJetton.js';
import { SwapPayload } from '@dedust/kit/dist/cpmm-v2/abi/messages/SwapPayload.js';
import { ExtendedPayoutConfig } from '@dedust/kit/dist/cpmm-v2/abi/types/ExtendedPayoutConfig.js';
import { PayoutOptions } from '@dedust/kit/dist/cpmm-v2/abi/types/PayoutOptions.js';

export const DEDUST_GAS = Object.freeze({
  native: 250000000n,
  jetton: 350000000n,
  forward: 300000000n,
});
// Distinct markers prevent refunds or incidental gas messages from proving a fill.
export const settlementMarker = (queryId, success) =>
  beginCell()
    .storeUint(success ? 0x44444f4b : 0x44444e4f, 32)
    .storeUint(BigInt(queryId), 64)
    .endCell();

export function buildDedustMessage(parsed, route, owner, queryId, deadline) {
  const recipient = Address.parse(owner),
    pool = Address.parse(route.poolAddress),
    amount = BigInt(parsed.inputUnits),
    minimum = BigInt(route.minOut);
  const fulfill = settlementMarker(queryId, true),
    reject = settlementMarker(queryId, false);
  const native = parsed.source.address === 'TON',
    gasNano = DEDUST_GAS[native ? 'native' : 'jetton'];
  let body, destination;
  if (route.version === 'cpmm-v2') {
    const payoutConfig = ExtendedPayoutConfig.create({
      excessesTo: recipient,
      fulfill: PayoutOptions.create({
        destination: recipient,
        payload: fulfill,
        wrapPayload: true,
      }),
      reject: PayoutOptions.create({ destination: recipient, payload: reject, wrapPayload: true }),
    });
    const paymentPayload = SwapPayload.createCell({ minimalAmountOut: minimum, deadline });
    body = native
      ? PayNative.createCell({ amount, queryId: BigInt(queryId), paymentPayload, payoutConfig })
      : PayJetton.createSlice({ paymentPayload, payoutConfig }).asCell();
    destination = route.poolAddress;
  } else {
    const params = {
      deadline,
      recipientAddress: recipient,
      fulfillPayload: fulfill,
      rejectPayload: reject,
    };
    const swap = VaultJetton.createSwapPayload({
      poolAddress: pool,
      limit: minimum,
      swapParams: params,
    });
    // Native and jetton vaults share the exact step/params tail after the opcode.
    body = native
      ? beginCell()
          .storeUint(0xea06185d, 32)
          .storeUint(BigInt(queryId), 64)
          .storeCoins(amount)
          .storeSlice(swap.beginParse().skip(32))
          .endCell()
      : swap;
    destination = route.inputVault;
  }
  if (!native) {
    body = beginCell()
      .storeUint(0x0f8a7ea5, 32)
      .storeUint(BigInt(queryId), 64)
      .storeCoins(amount)
      .storeAddress(Address.parse(destination))
      .storeAddress(recipient)
      .storeMaybeRef(null)
      .storeCoins(DEDUST_GAS.forward)
      .storeBit(true)
      .storeRef(body)
      .endCell();
    destination = route.inputWallet;
  }
  return {
    message: {
      destination,
      amountNano: (gasNano + (native ? amount : 0n)).toString(),
      bodyBoc: body.toBoc().toString('base64'),
      bounce: true,
    },
    gasNano: gasNano.toString(),
  };
}
