import { Buffer } from 'buffer';
import { requestJSON } from './http.js';
import { AgentError } from '../shared/errors.js';
import { MEDIA_MAX_BYTES } from '../domain/workspace.js';

const PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

/** SDK multipart constructors and the provider credential are bound in composition. */
export function createPinata({ fetcher, jwt = '', makeFormData, makeFile }) {
  const configured = Boolean(jwt);
  async function pinFile(name, bytes) {
    if (!configured)
      throw new AgentError(
        'ipfs_not_configured',
        'Image hosting is not configured. Configure the Pinata key or provide a ready metadata_uri.',
        { effectNotStarted: true },
      );
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MEDIA_MAX_BYTES)
      throw new AgentError('media_size', 'The image exceeds 5 MiB or is not binary data.', {
        effectNotStarted: true,
      });
    if (typeof name !== 'string' || !name.trim() || /[\r\n\0]/.test(name))
      throw new AgentError('invalid_arguments', 'A valid upload filename is required.', {
        effectNotStarted: true,
      });
    const body = makeFormData();
    body.append('file', makeFile(bytes, name));
    const result = await requestJSON(
      fetcher,
      PIN_FILE_URL,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        body,
      },
      65536,
    );
    if (typeof result?.IpfsHash !== 'string' || !/^[A-Za-z0-9]{20,128}$/.test(result.IpfsHash))
      throw new AgentError(
        'ipfs_invalid_response',
        'Image hosting returned an invalid content identifier.',
      );
    return result.IpfsHash;
  }
  return Object.freeze({
    configured,
    pinFile,
    pinJSON: (name, value) => pinFile(name, Buffer.from(JSON.stringify(value), 'utf8')),
  });
}
