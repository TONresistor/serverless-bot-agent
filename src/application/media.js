import { MEDIA_MAX_BYTES, workspacePath } from '../domain/workspace.js';
import { AgentError } from '../shared/errors.js';
import { digest, sha256Bytes } from '../shared/hash.js';
import { canonicalJSON } from '../shared/canonical.js';

export function normalizeMediaName(raw) {
  if (typeof raw !== 'string')
    throw new AgentError('invalid_arguments', 'A filename is required.', {
      effectNotStarted: true,
    });
  let name = raw.trim().replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '';
  if (!name || name === '.' || name === '..')
    throw new AgentError('invalid_arguments', 'A filename is required.', {
      effectNotStarted: true,
    });
  if (!name.includes('.')) name += '.jpg';
  workspacePath(`media/${name}`);
  return name;
}

function validateMedia(bytes) {
  if (!(bytes instanceof Uint8Array))
    throw new AgentError('invalid_media', 'The image must contain binary data.', {
      effectNotStarted: true,
    });
  if (bytes.byteLength > MEDIA_MAX_BYTES)
    throw new AgentError('media_size', 'The image exceeds 5 MiB.', { effectNotStarted: true });
}

export function createMediaService({ download, workspace, assertActive = async () => {} }) {
  function validateSave(fileId, name) {
    if (typeof fileId !== 'string' || !fileId.trim())
      throw new AgentError('invalid_arguments', 'A Telegram file_id is required.', {
        effectNotStarted: true,
      });
    normalizeMediaName(name);
  }
  return Object.freeze({
    validateSave,
    async save(fileId, name, _invocation) {
      validateSave(fileId, name);
      await assertActive();
      const bytes = await download(fileId.trim());
      validateMedia(bytes);
      const path = `media/${normalizeMediaName(name)}`;
      await assertActive();
      await workspace.writeMedia(path, bytes);
      return { saved: true, path, bytes: bytes.byteLength };
    },
  });
}

/** Hosting is separate from transaction signing and records each acknowledged CID. */
export function createMetadataService({
  pinata,
  download,
  workspace,
  journal,
  assertActive = async () => {},
}) {
  async function pinOnce(operationKey, stage, signature, upload) {
    const id = `ipfs:${digest(operationKey)}:${stage}`;
    const previous = await journal.operation(id);
    if (previous) {
      if (previous.data.signature !== signature)
        throw new AgentError(
          'operation_mismatch',
          'This image hosting operation belongs to different metadata.',
        );
      if (previous.state === 'succeeded') return previous.data.cid;
      throw new AgentError(
        'ipfs_operation_unknown',
        'This upload already started. Its result must be reconciled before trying again.',
      );
    }
    await assertActive();
    if (!(await journal.claim(id, 'ipfs', 'uploading', { signature })))
      throw new AgentError('ipfs_operation_unknown', 'This image upload is already in progress.');
    try {
      await assertActive();
      const cid = await upload();
      if (!(await journal.transition(id, ['uploading'], 'succeeded', { signature, cid })))
        throw new AgentError(
          'ipfs_operation_unknown',
          'The uploaded image receipt could not be saved.',
        );
      return cid;
    } catch (error) {
      await journal.transition(
        id,
        ['uploading'],
        error instanceof AgentError && error.effectNotStarted ? 'failed' : 'unknown',
        { signature },
      );
      throw error;
    }
  }

  return Object.freeze({
    async prepare(input, operationKey) {
      if (typeof input.metadataUri === 'string' && input.metadataUri.trim())
        return { metadataUri: input.metadataUri.trim() };
      if (!pinata?.configured)
        throw new AgentError(
          'ipfs_not_configured',
          'Image hosting is not configured. Configure the Pinata key or provide a ready metadata_uri.',
          { effectNotStarted: true },
        );
      if (typeof operationKey !== 'string' || !operationKey.trim())
        throw new AgentError(
          'invalid_operation',
          'An image hosting operation identifier is required.',
          { effectNotStarted: true },
        );
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        typeof input.symbol !== 'string' ||
        !input.symbol.trim()
      )
        throw new AgentError('invalid_arguments', 'The token name and symbol are required.', {
          effectNotStarted: true,
        });
      await assertActive();
      let bytes, filename;
      if (typeof input.image === 'string' && input.image.trim()) {
        const path = workspacePath(input.image);
        bytes = await workspace.readMedia(path);
        filename = path.split('/').at(-1);
      } else if (typeof input.imageFileId === 'string' && input.imageFileId.trim()) {
        bytes = await download(input.imageFileId.trim());
        filename = 'logo.jpg';
      } else
        throw new AgentError(
          'invalid_arguments',
          'Provide a saved workspace image or an attached image file_id.',
          { effectNotStarted: true },
        );
      validateMedia(bytes);
      const imageCid = await pinOnce(operationKey, 'logo', sha256Bytes(bytes).toString('hex'), () =>
        pinata.pinFile(filename, bytes),
      );
      const metadata = {
        name: input.name.trim(),
        symbol: input.symbol.trim(),
        ...(typeof input.description === 'string' && input.description.trim()
          ? { description: input.description.trim() }
          : {}),
        image: `ipfs://${imageCid}`,
        decimals: '9',
      };
      const metadataCid = await pinOnce(
        operationKey,
        'metadata',
        digest(canonicalJSON(metadata)),
        () => pinata.pinJSON('metadata.json', metadata),
      );
      return { metadataUri: `ipfs://${metadataCid}`, imageCid, metadataCid };
    },
  });
}
