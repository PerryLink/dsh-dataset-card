/**
 * `dataset_card` — Datasheet-style card export.
 * @module dsh-dataset-card/tools/dataset-card
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { DcError, type DatasetRuntime } from '../runtime.ts'
import type { CardInput } from '../card.ts'
import type { DatasetInspection } from '../inspect.ts'
import { ERROR_SCHEMA } from './shared.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    card: { type: 'json' },
    markdown: { type: 'string' },
    sarif: { type: 'json' },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `dataset_card` tool.
 * @param runtime - the runtime.
 * @returns the tool definition.
 */
export function makeDatasetCardTool(runtime: DatasetRuntime) {
  return defineTool({
    name: 'dataset_card',
    description: [
      'Build a Datasheet-style dataset card from an inspection plus metadata (dsh-dataset-card).',
      '',
      'Sections: Motivation, Composition, Collection, Preprocessing, Uses, Distribution, Maintenance — each missing one is listed and becomes a SARIF warning. The card includes the redacted privacy findings and the inspection issues, with the Markdown and JSON forms.',
    ].join('\n'),
    parameters: {
      inspection: { type: 'json', required: true, description: 'The inspection from dataset_inspect.' },
      title: { type: 'string' },
      description: { type: 'string' },
      creators: { type: 'string' },
      license: { type: 'string' },
      ethics: { type: 'string' },
      doi: { type: 'string' },
      motivation: { type: 'string' },
      composition: { type: 'string' },
      collection: { type: 'string' },
      preprocessing: { type: 'string' },
      uses: { type: 'string' },
      distribution: { type: 'string' },
      maintenance: { type: 'string' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; markdown: string; card: { missingSections: string[] } } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `dataset_card failed (${result.error.code}): ${result.error.message}` }]
        return [{ type: 'text', text: `${result.markdown}\n\n_Missing sections: ${result.card.missingSections.join(', ') || 'none'}._` }]
      },
    },
    async execute(args: unknown) {
      const request = args as { inspection?: DatasetInspection } & CardInput
      if (request.inspection === undefined || !Array.isArray(request.inspection.columns)) {
        return { ok: false as const, error: { code: 'INVALID_INPUT', message: 'pass the inspection object from dataset_inspect' } }
      }
      try {
        const card = runtime.card(request.inspection, request)
        return { ok: true as const, card: card as never, markdown: card.markdown, sarif: card.sarif as never }
      } catch (error) {
        if (error instanceof DcError) return { ok: false as const, error: { code: error.code, message: error.message } }
        throw error
      }
    },
  })
}
