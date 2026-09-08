import { onBusinessMessage } from 'lib/runtime';
export default async function (message, context) {
  return onBusinessMessage(message, context);
}
