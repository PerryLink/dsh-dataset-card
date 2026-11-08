/**
 * `dataset_inspect` — profile a dataset without copying its rows.
 * @module dsh-dataset-card/tools/dataset-inspect
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { DcError, type DatasetRuntime } from '../runtime.ts'
import { ERROR_SCHEMA } from './shared.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    inspection: { type: 'json' },
    evidenceId: { type: 'string' },
    recordPath: { type: 'string' },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `dataset_inspect` tool.
 * @param runtime - the runtime.
 * @returns the tool definition.
 */
export function makeDatasetInspectTool(runtime: DatasetRuntime) {
  return defineTool({
    name: 'dataset_inspect',
    description: [
      'Profile a tabular dataset for a Datasheet (dsh-dataset-card).',
      '',
      'Reads .csv/.tsv/.json/.jsonl with a row cap, infers column types, reports missingness and sampled cardinality, and flags PII-like columns by name and by value pattern (emails, phones, national IDs, IPs) with REDACTED evidence — raw values never appear in the output or in stored evidence.',
      '',
      'An inspection is a sample profile, not a privacy audit: absence of a finding does not prove the dataset is de-identified.',
    ].join('\n'),
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative dataset file.' },
      label: { type: 'string', description: 'Human label (default: the path).' },
      license: { type: 'string', description: 'Declared license (e.g. CC BY 4.0).' },
      ethics: { type: 'string', description: 'Ethics/consent statement.' },
      persist: { type: 'boolean', description: 'Store the analysis (not the rows) as REP evidence (default true).' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; inspection: { rowsScanned: number; columns: unknown[]; pii: unknown[]; risk: string; issues: unknown[] } } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `dataset_inspect failed (${result.error.code}): ${result.error.message}` }]
        return [
          {
            type: 'text',
            text: `dataset_inspect: ${result.inspection.rowsScanned} row(s), ${result.inspection.columns.length} column(s); privacy risk ${result.inspection.risk}; ${result.inspection.pii.length} PII finding(s); ${result.inspection.issues.length} issue(s)`,
          },
        ]
      },
    },
    async execute(args: unknown) {
      const request = args as Parameters<DatasetRuntime['inspect']>[0]
      try {
        const result = await runtime.inspect(request)
        return {
          ok: true as const,
          inspection: result.inspection as never,
          ...(result.evidenceId === undefined ? {} : { evidenceId: result.evidenceId }),
          ...(result.recordPath === undefined ? {} : { recordPath: result.recordPath }),
        }
      } catch (error) {
        if (error instanceof DcError) return { ok: false as const, error: { code: error.code, message: error.message } }
        throw error
      }
    },
  })
}
