import { decodeMetadata } from '../../domain/chain/metadata.js';
import { chainAddress } from '../../domain/chain/values.js';
import { publicWebURL } from '../../shared/web-url.js';

function safeImage(value) {
  if (/^ipfs:\/\/[^\s]+$/.test(value)) return value;
  try {
    return publicWebURL(value);
  } catch {
    return '';
  }
}

/** Only TON Center's fixed index endpoint fetches metadata; no token-controlled
 * DNS origin or redirect can cause an outbound request from this runtime. */
export async function resolveMetadata(content, { chain, address, network, collection = false }) {
  let fields;
  try {
    fields = decodeMetadata(content);
  } catch {
    fields = { name: '', description: '', image: '', uri: '' };
  }
  fields.image = safeImage(fields.image);
  const unavailable = () => ({
    ...fields,
    ...(!fields.name || !fields.image ? { metadata_status: 'unavailable' } : {}),
  });
  if ((fields.name && fields.image) || !chain.indexed) return unavailable();
  try {
    const raw = address.toRawString();
    const data = await chain.indexed(
      collection ? '/nft/collections' : '/nft/items',
      collection ? { collection_address: raw, limit: 1 } : { address: raw, limit: 1 },
    );
    const sameAddress = (value) => {
      try {
        return chainAddress(value, network).equals(address);
      } catch {
        return false;
      }
    };
    const rows = collection ? data.nft_collections : data.nft_items;
    const row = Array.isArray(rows) ? rows.find((item) => sameAddress(item?.address)) : null;
    if (!row) return unavailable();
    const inline = collection ? row.collection_content : row.content;
    const indexed = Object.entries(data.metadata || {}).find(([key]) => sameAddress(key))?.[1];
    const entry = indexed?.token_info?.find(
      (item) => item && typeof item === 'object' && item.valid !== false,
    );
    for (const source of [inline, entry]) {
      if (!source || typeof source !== 'object') continue;
      for (const key of ['name', 'description', 'image']) {
        if (!fields[key] && typeof source[key] === 'string')
          fields[key] = (key === 'image' ? safeImage(source[key]) : source[key]).slice(
            0,
            key === 'description' ? 8192 : 4096,
          );
      }
    }
    return { ...fields, metadata_status: fields.name || fields.image ? 'indexed' : 'unavailable' };
  } catch {
    return unavailable();
  }
}
