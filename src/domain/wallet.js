import { Buffer } from 'buffer';
import {
  Address,
  Cell,
  beginCell,
  external,
  internal,
  storeMessage,
  toNano,
  fromNano,
} from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton/dist/wallets/v5r1/WalletContractV5R1.js';
import { publicKeyFromSeed, sign, signVerify } from './crypto.js';
import { digest } from '../shared/hash.js';
import { AgentError } from '../shared/errors.js';

export const GAS_RESERVE = 50_000_000n;

export function walletContract(publicKeyHex, network) {
  if (!/^[a-f0-9]{64}$/i.test(publicKeyHex) || !['testnet', 'mainnet'].includes(network))
    throw new AgentError('wallet_config', 'Invalid wallet configuration.');
  return WalletContractV5R1.create({
    publicKey: Buffer.from(publicKeyHex, 'hex'),
    walletId: {
      networkGlobalId: network === 'testnet' ? -3 : -239,
      context: { workchain: 0, walletVersion: 'v5r1', subwalletNumber: 0 },
    },
  });
}

export function walletAddress(publicKeyHex, network) {
  return walletContract(publicKeyHex, network).address.toString({
    bounceable: false,
    testOnly: network === 'testnet',
  });
}

export function parseAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,9})?$/.test(value)) {
    throw new AgentError(
      'invalid_amount',
      'Amount must be a positive decimal string with at most 9 decimal places.',
    );
  }
  const nano = toNano(value);
  if (nano <= 0n) throw new AgentError('invalid_amount', 'Amount must be greater than zero.');
  return nano;
}

export function parseDestination(value, network) {
  try {
    if (typeof value !== 'string' || value.length > 100) throw new Error();
    if (Address.isFriendly(value)) {
      const friendly = Address.parseFriendly(value);
      if (network === 'mainnet' && friendly.isTestOnly) throw new Error();
    }
    const address = Address.parse(value);
    return {
      raw: address.toRawString(),
      friendly: address.toString({ bounceable: false, testOnly: network === 'testnet' }),
    };
  } catch {
    throw new AgentError('invalid_address', 'Invalid TON address for this network.');
  }
}

export const formatTON = (value) => fromNano(BigInt(value));

function signWalletMessage({
  publicKey,
  secretKey,
  network,
  seqno,
  state,
  now,
  message: outgoing,
}) {
  if (!/^[a-f0-9]{128}$/i.test(secretKey))
    throw new AgentError('wallet_key', 'Invalid wallet key.');
  const secret = Buffer.from(secretKey, 'hex');
  if (publicKeyFromSeed(secret.subarray(0, 32)).toString('hex') !== publicKey)
    throw new AgentError('wallet_key', 'Wallet key mismatch.');
  const wallet = walletContract(publicKey, network);
  const expiresAt = Math.floor(now / 1000) + 120;
  const body = wallet.createTransfer(
    /** @type {import('@ton/ton/dist/wallets/v5r1/WalletContractV5R1.js').WalletV5R1SendArgsSinged & { messages: import('@ton/core').MessageRelaxed[], sendMode: number }} */ ({
      seqno,
      timeout: expiresAt,
      secretKey: secret,
      sendMode: 3,
      messages: [outgoing],
    }),
  );
  const message = beginCell()
    .store(
      storeMessage(
        external({
          to: wallet.address,
          init: state === 'uninitialized' ? wallet.init : undefined,
          body,
        }),
      ),
    )
    .endCell();
  return {
    boc: message.toBoc({ idx: false }).toString('base64'),
    bodyHash: body.hash().toString('hex'),
    messageHash: message.hash().toString('hex'),
    seqno,
    validUntil: expiresAt,
  };
}

export function signTransfer(args) {
  return signWalletMessage({
    ...args,
    message: internal({
      to: Address.parse(args.destination),
      value: BigInt(args.amountNano),
      bounce: args.destinationState === 'active',
      body: args.comment || undefined,
    }),
  });
}
export function signContractMessage(args) {
  const message = args.message;
  return signWalletMessage({
    ...args,
    message: internal({
      to: Address.parse(message.destination),
      value: BigInt(message.amountNano),
      bounce: true,
      body: Cell.fromBase64(message.bodyBoc),
    }),
  });
}

export function cryptoProbe() {
  const seed = Buffer.alloc(32, 7);
  const publicKey = publicKeyFromSeed(seed);
  const key = Buffer.concat([seed, publicKey]);
  const bytes = Buffer.from('serverless-wallet-probe');
  const signature = sign(bytes, key);
  return {
    valid: signVerify(bytes, signature, publicKey),
    signature: signature.toString('hex'),
    address: walletAddress(publicKey.toString('hex'), 'testnet'),
    hash: digest('abc'),
  };
}
