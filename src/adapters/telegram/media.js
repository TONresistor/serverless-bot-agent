import { Buffer } from 'buffer';
import { MEDIA_MAX_BYTES } from '../../domain/workspace.js';
import { AgentError } from '../../shared/errors.js';

/** Only native file readers are bound here; tools never receive the SDK. */
export function createTelegramMedia({ getFileContent, getFileStream = undefined }) {
  return Object.freeze({
    async download(fileId) {
      if (typeof fileId !== 'string' || !fileId.trim())
        throw new AgentError('invalid_arguments', 'A Telegram file_id is required.', {
          effectNotStarted: true,
        });
      try {
        if (getFileStream) {
          const stream = await getFileStream(fileId.trim());
          if (!stream?.[Symbol.asyncIterator])
            throw new AgentError(
              'invalid_media_response',
              'Telegram did not return a binary file stream.',
            );
          const chunks = [];
          let size = 0;
          for await (const chunk of stream) {
            if (!(chunk instanceof Uint8Array))
              throw new AgentError(
                'invalid_media_response',
                'Telegram did not return binary file content.',
              );
            size += chunk.byteLength;
            if (size > MEDIA_MAX_BYTES)
              throw new AgentError('media_size', 'The image exceeds 5 MiB.');
            chunks.push(chunk);
          }
          return Buffer.concat(chunks, size);
        }
        const bytes = await getFileContent(fileId.trim());
        if (!(bytes instanceof Uint8Array))
          throw new AgentError(
            'invalid_media_response',
            'Telegram did not return binary file content.',
          );
        if (bytes.byteLength > MEDIA_MAX_BYTES)
          throw new AgentError('media_size', 'The image exceeds 5 MiB.');
        return bytes;
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError('media_download', 'The Telegram image could not be downloaded.');
      }
    },
  });
}
