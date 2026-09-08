import { formatTON } from '../domain/wallet.js';

export function createCommandHandler({ conversations, operations, sendOnce, turns }) {
  return async function handleCommand({
    input,
    event,
    config,
    chatId,
    ton,
    transfers,
    scope = { owner: true, group: false },
    respond = (text) => sendOnce(event, config.ownerId, text),
  }) {
    const command = /^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s|$)/i.exec(input)?.[1].toLowerCase();
    if (!command) return null;
    if (command === 'start' || command === 'help') {
      await respond(
        'I am your AI agent. Chat with me, ask me to remember a fact or check your wallet.\n\n/wallet — address, balance and transfers\n/reset — new conversation, saved memory retained\n/stop — stop the current turn\n/help — show this help\n\nTransfers require your confirmation.',
      );
      return { command };
    }
    if (command === 'reset' && !scope.owner) {
      await respond('Only the owner can reset the shared conversation.');
      return { command: 'denied' };
    }
    if (command === 'wallet' && (scope.group || !scope.owner)) {
      await respond('Use /wallet in the private owner chat.');
      return { command: 'private_only' };
    }
    if (command === 'reset') {
      await turns?.clearSummary(chatId, event);
      await conversations.saveHistory(chatId, event, []);
      await respond('New conversation started. Saved facts have been retained.');
      return { command };
    }
    if (command === 'wallet') {
      let reconciliation;
      try {
        reconciliation = await transfers.reconcile();
      } catch {
        reconciliation = { state: 'unknown' };
      }
      let balance;
      try {
        balance = `${formatTON((await ton.state(transfers.address)).balance)} TON`;
      } catch {
        balance = 'temporarily unavailable';
      }
      const recent = await operations.recentTransfers();
      const labels = {
        pending: 'awaiting confirmation',
        preparing: 'preparing',
        in_flight: 'submission needs verification',
        submitted: 'awaiting network confirmation',
        unknown: 'uncertain outcome — no automatic resend',
        confirmed: 'confirmed',
        failed: 'failed',
        cancelled: 'cancelled',
        expired: 'expired',
      };
      const lines = recent.map((op) =>
        op.kind === 'contract_action'
          ? `${op.data.tool} — ${labels[op.state] || op.state}`
          : `${formatTON(op.data.amountNano)} TON — ${labels[op.state] || op.state}`,
      );
      const warning =
        reconciliation?.state === 'unknown'
          ? '\nA submission still needs to be verified on the network.'
          : '';
      await respond(
        `Wallet ${config.network.toUpperCase()}\n${transfers.address}\nBalance: ${balance}${warning}${lines.length ? '\n\nRecent transfers:\n' + lines.join('\n') : ''}`,
      );
      return { command };
    }
    if (scope.group) return { command: 'ignored' };
    await respond('Unknown command. See /help.');
    return { command: 'unknown' };
  };
}
