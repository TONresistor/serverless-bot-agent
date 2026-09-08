/** @typedef {{ file_id: string; name: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'save_media',
  description:
    'Save an image the user sent, using the file_id in the Attached image note, into the persistent workspace under media/<name>. Give a short filename such as duck.png. Use workspace_list to find saved images for reuse as token logos.',
  properties: {
    file_id: string('Telegram file_id from the attached image.', 1024),
    name: string(
      'Short filename, such as duck.png. Directory components are removed; the default extension is .jpg.',
      512,
    ),
  },
  required: ['file_id', 'name'],
});

/** @param {import('../../contracts/capabilities.js').MediaPort} capabilities */
export function createSaveMediaTool({ validateSave, save }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'state_write',
      metadata: {
        family: 'media',
        exposure: 'search',
        keywords: ['image', 'photo', 'save', 'workspace', 'logo'],
      },
      validate: (args) => validateSave(args.file_id, args.name),
      execute: (args, invocation) => save(args.file_id, args.name, invocation),
    }),
  );
}
