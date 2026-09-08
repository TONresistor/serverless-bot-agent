import { onGuestMessage } from 'lib/runtime';
export default async function (message, context) {
  return onGuestMessage(message, context);
}
