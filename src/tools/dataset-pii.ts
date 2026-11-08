/**
 * `dataset_pii` — a focused, redacted PII summary of an inspection.
 * @module dsh-dataset-card/tools/dataset-pii
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ERROR_SCHEMA, inspectionProblem } from './shared.ts'
import type { DatasetInspection } from '../inspect.ts'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    summary: { type: 'json' },
    error: ERROR_SCHEMA,
  },
} as const

/**
 * Build the `dataset_pii` tool.
 * @returns the tool definition.
 */
export function makeDatasetPiiTool() {
  return defineTool({
    name: 'dataset_pii',
    description: [
      'Summarize the PII findings from a dataset_inspect result (dsh-dataset-card).',
      '',
      'Groups redacted findings by kind and risk, states what to do next (de-identify, restrict access, record consent), and repeats that this is a pattern scan of a sample — not a guarantee that the dataset is anonymous.',
    ].join('\n'),
    parameters: {
      inspection: { type: 'json', required: true, description: 'The inspection from dataset_inspect.' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        const result = value as { ok: true; summary: { risk: string; byKind: Record<string, number>; recommendations: string[] } } | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `dataset_pii failed (${result.error.code}): ${result.error.message}` }]
        return [{ type: 'text', text: `dataset_pii: risk ${result.summary.risk}; kinds ${Object.entries(result.summary.byKind).map(([kind, count]) => `${kind}×${count}`).join(', ') || 'none'}` }]
      },
    },
    async execute(args: unknown) {
      const request = args as { inspection?: DatasetInspection }
      const problem = inspectionProblem(request.inspection)
      if (problem !== undefined) {
        return { ok: false as const, error: { code: 'INVALID_INPUT', message: `pass the inspection object from dataset_inspect (${problem})` } }
      }
      const inspection = request.inspection as DatasetInspection
      const byKind: Record<string, number> = {}
      for (const finding of inspection.pii) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1
      const recommendations: string[] = []
      if (inspection.risk === 'high') recommendations.push('treat the dataset as personal data: de-identify or restrict access before sharing, and document the consent basis')
      else if (inspection.risk === 'medium') recommendations.push('review the flagged columns and decide whether they can be removed, generalized or kept under restricted access')
      else if (inspection.risk === 'low') recommendations.push('confirm the low-risk fields cannot be linked to individuals when combined')
      else recommendations.push('no PII pattern was found in the scanned sample; this is not proof of anonymity')
      recommendations.push('record the de-identification performed and the legal/ethics basis in the dataset card')
      return {
        ok: true as const,
        summary: {
          risk: inspection.risk,
          byKind,
          findings: inspection.pii.map(finding => ({ column: finding.column, kind: finding.kind, risk: finding.risk, count: finding.count, evidence: finding.evidence })),
          recommendations,
        } as never,
      }
    },
  })
}
