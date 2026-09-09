import { Buffer } from 'buffer';
import { walletAddress, cryptoProbe } from '../domain/wallet.js';
import { publicKeyFromSeed } from '../domain/crypto.js';

/** Administrative capabilities never enter a tool registry or message payload. */
export function createAdmin({ configuration, secrets, telegram, getChain, checkStorage }) {
  async function status() {
    const config = await configuration.getConfig();
    if (!config) return { configured: false };
    return {
      configured: true,
      owner_id: config.ownerId,
      bot_id: config.botId,
      model: config.model,
      network: config.network,
      address: walletAddress(config.walletPublicKey, config.network),
      openrouter_configured: Boolean(await secrets.getSecret('openrouter')),
      toncenter_configured: Boolean(await secrets.getSecret('toncenter')),
    };
  }
  return {
    status,
    async configure(input) {
      if (
        !Number.isSafeInteger(input.ownerId) ||
        input.ownerId <= 0 ||
        !['testnet', 'mainnet'].includes(input.network) ||
        typeof input.model !== 'string' ||
        !/^[a-z0-9_-]+\/[a-z0-9._:-]+$/i.test(input.model) ||
        typeof input.openrouterKey !== 'string' ||
        !input.openrouterKey ||
        !/^[a-f0-9]{128}$/i.test(input.walletKey)
      )
        throw new Error('Invalid configuration');
      const publicKey = publicKeyFromSeed(
        Buffer.from(input.walletKey, 'hex').subarray(0, 32),
      ).toString('hex');
      const existing = await configuration.getConfig();
      if (
        existing &&
        (existing.ownerId !== input.ownerId ||
          existing.walletPublicKey !== publicKey ||
          existing.network !== input.network)
      )
        throw new Error('Refusing to replace an existing owner or wallet');
      const me = await telegram.getMe();
      await secrets.setSecret('openrouter', input.openrouterKey);
      await secrets.setSecret('wallet_key', input.walletKey);
      if (Object.hasOwn(input, 'toncenterKey') || !existing)
        await secrets.setSecret('toncenter', input.toncenterKey || '');
      await configuration.setConfig({
        ownerId: input.ownerId,
        botId: me.id,
        model: input.model,
        network: input.network,
        walletPublicKey: publicKey,
        personality: typeof input.personality === 'string' ? input.personality.slice(0, 2000) : '',
      });
      return status();
    },
    async probe() {
      return { crypto: cryptoProbe(), sql: await checkStorage() };
    },
    async walletStatus() {
      const config = await configuration.getConfig();
      if (!config) return { configured: false };
      const ton = await getChain(config);
      return {
        ...(await status()),
        account: await ton.state(walletAddress(config.walletPublicKey, config.network)),
      };
    },
  };
}
