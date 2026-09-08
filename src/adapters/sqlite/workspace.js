import {
  MEDIA_MAX_BYTES,
  workspacePath,
  validateWorkspaceContent,
} from '../../domain/workspace.js';
import { AgentError } from '../../shared/errors.js';
import { digest, sha256Bytes } from '../../shared/hash.js';
import { Buffer } from 'buffer';

const MEDIA_CHUNK_BYTES = 64 * 1024;
const conflict = () => {
  throw new AgentError(
    'workspace_conflict',
    'The workspace file changed. Read its current revision first.',
  );
};

export function createWorkspaceRepository(db, now) {
  return {
    async seed(path, content) {
      path = workspacePath(path);
      validateWorkspaceContent(content);
      await db.run(
        "INSERT INTO agent_workspace(id,scope,path,content,revision,updated_at) VALUES(:id,'agent',:path,:content,1,:now) ON CONFLICT(id) DO NOTHING",
        { ':id': `agent:${path}`, ':path': path, ':content': content, ':now': now() },
      );
    },
    port(scope = 'agent', assertActive = async () => {}, fence = undefined) {
      const guard = fence
        ? "EXISTS(SELECT 1 FROM agent_operations WHERE id=:lock AND state='held' AND data_json=:token AND expires_at>:now)"
        : '1=1';
      const leaseParams = () => ({
        ':now': now(),
        ...(fence
          ? { ':lock': `lock:chat:${fence.chatId}`, ':token': JSON.stringify(fence.token) }
          : {}),
      });
      async function persist(path, content, bytes, expectedRevision = undefined) {
        await assertActive();
        const values = {
          ':id': `${scope}:${path}`,
          ':content': content,
          ':kind': bytes === null ? 'text' : 'binary',
          ':bytes': bytes,
          ':count': bytes === null ? Buffer.byteLength(content) : bytes.byteLength,
          ...leaseParams(),
        };
        const insert = `INSERT INTO agent_workspace(id,scope,path,content,content_kind,content_bytes,byte_count,revision,updated_at) SELECT :id,:scope,:path,:content,:kind,:bytes,:count,1,:now WHERE ${guard}`;
        const replace =
          'content=:content,content_kind=:kind,content_bytes=:bytes,byte_count=:count,revision=revision+1,updated_at=:now';
        let changed;
        if (expectedRevision === undefined)
          changed = await db.run(`${insert} ON CONFLICT(id) DO UPDATE SET ${replace}`, {
            ...values,
            ':scope': scope,
            ':path': path,
          });
        else if (expectedRevision === 0)
          changed = await db.run(`${insert} ON CONFLICT(id) DO NOTHING`, {
            ...values,
            ':scope': scope,
            ':path': path,
          });
        else
          changed = await db.run(
            `UPDATE agent_workspace SET ${replace} WHERE id=:id AND revision=:revision AND ${guard}`,
            { ...values, ':revision': expectedRevision },
          );
        if (changed.rowsAffected !== 1) conflict();
        return { path, bytes: values[':count'] };
      }
      async function persistStaged(path, bytes, expectedRevision) {
        await assertActive();
        const stagingScope = `staging:${scope}`;
        const stage = `stage:${digest(`${scope}:${fence?.token || 'admin'}:${path}:${now()}:${sha256Bytes(bytes).toString('hex')}`)}`;
        await db.run(
          "DELETE FROM agent_workspace WHERE scope=:scope AND content_kind='binary_staging' AND updated_at<:cutoff",
          { ':scope': stagingScope, ':cutoff': now() - 3600000 },
        );
        let claimed = false;
        try {
          const created = await db.run(
            `INSERT INTO agent_workspace(id,scope,path,content,content_kind,content_bytes,byte_count,revision,updated_at) SELECT :stage,:scope,:path,'','binary_staging',X'',0,1,:now WHERE ${guard} ON CONFLICT(id) DO NOTHING`,
            { ':stage': stage, ':scope': stagingScope, ':path': path, ...leaseParams() },
          );
          if (created.rowsAffected !== 1) conflict();
          claimed = true;
          for (let offset = 0; offset < bytes.byteLength; offset += MEDIA_CHUNK_BYTES) {
            await assertActive();
            const chunk = bytes.subarray(
              offset,
              Math.min(offset + MEDIA_CHUNK_BYTES, bytes.byteLength),
            );
            const appended = await db.run(
              `UPDATE agent_workspace SET content_bytes=CAST(content_bytes || :chunk AS BLOB),byte_count=byte_count+:size,updated_at=:now WHERE id=:stage AND content_kind='binary_staging' AND byte_count=:offset AND ${guard}`,
              {
                ':stage': stage,
                ':chunk': chunk,
                ':size': chunk.byteLength,
                ':offset': offset,
                ...leaseParams(),
              },
            );
            if (appended.rowsAffected !== 1) conflict();
          }
          await assertActive();
          const params = {
            ':id': `${scope}:${path}`,
            ':stage': stage,
            ':stagingScope': stagingScope,
            ':count': bytes.byteLength,
            ...leaseParams(),
          };
          const staged =
            "id=:stage AND scope=:stagingScope AND content_kind='binary_staging' AND byte_count=:count";
          let published;
          if (expectedRevision === undefined || expectedRevision === 0) {
            const onConflict =
              expectedRevision === 0
                ? 'DO NOTHING'
                : "DO UPDATE SET content='',content_kind='binary',content_bytes=excluded.content_bytes,byte_count=excluded.byte_count,revision=agent_workspace.revision+1,updated_at=excluded.updated_at";
            published = await db.run(
              `INSERT INTO agent_workspace(id,scope,path,content,content_kind,content_bytes,byte_count,revision,updated_at) SELECT :id,:scope,:path,'','binary',content_bytes,byte_count,1,:now FROM agent_workspace WHERE ${staged} AND ${guard} ON CONFLICT(id) ${onConflict}`,
              { ...params, ':scope': scope, ':path': path },
            );
          } else {
            published = await db.run(
              `UPDATE agent_workspace SET content='',content_kind='binary',content_bytes=(SELECT content_bytes FROM agent_workspace WHERE ${staged}),byte_count=:count,revision=revision+1,updated_at=:now WHERE id=:id AND revision=:revision AND EXISTS(SELECT 1 FROM agent_workspace WHERE ${staged}) AND ${guard}`,
              { ...params, ':revision': expectedRevision },
            );
          }
          if (published.rowsAffected !== 1) conflict();
          return { path, bytes: bytes.byteLength };
        } finally {
          if (claimed)
            try {
              await db.run(
                "DELETE FROM agent_workspace WHERE id=:stage AND scope=:scope AND content_kind='binary_staging'",
                { ':stage': stage, ':scope': stagingScope },
              );
            } catch {
              /* A later media write removes abandoned staging rows. */
            }
        }
      }
      return {
        async list() {
          const rows = await db.all(
            'SELECT path FROM agent_workspace WHERE scope=:scope ORDER BY path',
            { ':scope': scope },
          );
          return {
            files: rows
              .map((r) => r.path)
              .filter((p) => !p.split('/').some((s) => s.startsWith('.'))),
          };
        },
        async read(path) {
          path = workspacePath(path);
          const row = await db.get(
            'SELECT content,content_kind,revision FROM agent_workspace WHERE scope=:scope AND path=:path',
            { ':scope': scope, ':path': path },
          );
          if (!row) throw new AgentError('workspace_not_found', 'Workspace file not found.');
          if (row.content_kind === 'binary')
            throw new AgentError(
              'workspace_binary_file',
              'This workspace file contains binary media. Use its path with a tool that accepts saved images.',
            );
          return {
            path,
            content: row.content,
            bytes: Buffer.byteLength(row.content),
            revision: row.revision,
          };
        },
        validate(path, content) {
          workspacePath(path);
          if (content !== undefined) validateWorkspaceContent(content);
        },
        async write(path, content, expectedRevision = undefined) {
          path = workspacePath(path);
          validateWorkspaceContent(content);
          return persist(path, content, null, expectedRevision);
        },
        async writeMedia(path, bytes, expectedRevision = undefined) {
          path = workspacePath(path);
          if (!(bytes instanceof Uint8Array))
            throw new AgentError('invalid_media', 'Workspace media must contain binary data.');
          if (bytes.byteLength > MEDIA_MAX_BYTES)
            throw new AgentError('media_size', 'Workspace media exceeds 5 MiB.');
          return bytes.byteLength > MEDIA_CHUNK_BYTES
            ? persistStaged(path, bytes, expectedRevision)
            : persist(path, '', bytes, expectedRevision);
        },
        async readMedia(path) {
          path = workspacePath(path);
          const id = `${scope}:${path}`;
          const row = await db.get(
            'SELECT content_kind,byte_count,revision FROM agent_workspace WHERE id=:id',
            { ':id': id },
          );
          if (!row) throw new AgentError('workspace_not_found', 'Workspace file not found.');
          if (row.content_kind === 'text') {
            const text = await db.get(
              "SELECT content FROM agent_workspace WHERE id=:id AND revision=:revision AND content_kind='text'",
              { ':id': id, ':revision': row.revision },
            );
            if (!text) conflict();
            const bytes = Buffer.from(text.content, 'utf8');
            if (bytes.byteLength > MEDIA_MAX_BYTES)
              throw new AgentError('media_size', 'Workspace media exceeds 5 MiB.');
            return bytes;
          }
          if (
            row.content_kind !== 'binary' ||
            !Number.isSafeInteger(row.byte_count) ||
            row.byte_count < 0
          )
            throw new AgentError('invalid_media', 'Workspace media could not be decoded.');
          if (row.byte_count > MEDIA_MAX_BYTES)
            throw new AgentError('media_size', 'Workspace media exceeds 5 MiB.');
          const pinned =
            "id=:id AND revision=:revision AND content_kind='binary' AND byte_count=:count AND length(content_bytes)=:count";
          const params = { ':id': id, ':revision': row.revision, ':count': row.byte_count };
          const bytes = new Uint8Array(row.byte_count);
          for (let offset = 0; offset < row.byte_count; offset += MEDIA_CHUNK_BYTES) {
            await assertActive();
            const size = Math.min(MEDIA_CHUNK_BYTES, row.byte_count - offset);
            const part = await db.get(
              `SELECT substr(content_bytes,:offset,:size) AS chunk FROM agent_workspace WHERE ${pinned}`,
              { ...params, ':offset': offset + 1, ':size': size },
            );
            if (!part) conflict();
            if (!(part.chunk instanceof Uint8Array) || part.chunk.byteLength !== size)
              throw new AgentError('invalid_media', 'Workspace media is incomplete.');
            bytes.set(part.chunk, offset);
          }
          if (!(await db.get(`SELECT 1 AS valid FROM agent_workspace WHERE ${pinned}`, params)))
            conflict();
          return bytes;
        },
      };
    },
  };
}
