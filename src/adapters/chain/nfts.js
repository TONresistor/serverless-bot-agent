import { chainAddress, friendlyAddress, nonnegative } from '../../domain/chain/values.js';
import { resolveMetadata } from './metadata.js';

export async function readNftData(chain, address) {
  const { stack } = await chain.runGetMethod(address.toRawString(), 'get_nft_data');
  return {
    initialized: stack.readBoolean(),
    index: nonnegative(stack.readBigNumber()),
    collection: stack.readAddressOpt(),
    owner: stack.readAddressOpt(),
    content: stack.readCellOpt(),
  };
}

function displayMetadata(meta) {
  return {
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.image ? { image: meta.image } : {}),
    ...(meta.uri ? { metadata_uri: meta.uri } : {}),
    ...(meta.metadata_status ? { metadata_status: meta.metadata_status } : {}),
  };
}

export function createNftReads({ chain, network }) {
  return {
    async nftInfo({ address }) {
      const item = chainAddress(address, network),
        data = await readNftData(chain, item);
      let content = data.content;
      if (data.collection && content) {
        try {
          content = (
            await chain.runGetMethod(data.collection.toRawString(), 'get_nft_content', [
              { type: 'int', value: data.index },
              { type: 'cell', cell: content },
            ])
          ).stack.readCell();
        } catch {
          /* Display metadata is best effort; ownership remains on-chain. */
        }
      }
      return {
        address: friendlyAddress(item, network),
        initialized: data.initialized,
        owner: data.owner ? friendlyAddress(data.owner, network) : 'none',
        ...(data.collection
          ? { collection: friendlyAddress(data.collection, network), index: data.index.toString() }
          : {}),
        ...displayMetadata(await resolveMetadata(content, { chain, address: item, network })),
      };
    },
    async nftCollectionInfo({ address }) {
      const collection = chainAddress(address, network);
      const { stack } = await chain.runGetMethod(collection.toRawString(), 'get_collection_data');
      const count = nonnegative(stack.readBigNumber()),
        content = stack.readCellOpt(),
        owner = stack.readAddressOpt();
      return {
        address: friendlyAddress(collection, network),
        owner: owner ? friendlyAddress(owner, network) : 'none',
        item_count: count.toString(),
        ...displayMetadata(
          await resolveMetadata(content, { chain, address: collection, network, collection: true }),
        ),
      };
    },
  };
}
