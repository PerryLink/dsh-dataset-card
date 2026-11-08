/**
 * Shared tool schema fragments and runtime argument guards.
 * @module dsh-dataset-card/tools/shared
 */

import type { DatasetFormat, DatasetInspection, PiiKind } from '../inspect.ts'

/** The failure branch. */
export const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const FORMATS: readonly DatasetFormat[] = ['csv', 'tsv', 'json', 'jsonl']
const PII_KINDS: readonly PiiKind[] = ['name', 'email', 'phone', 'identifier', 'address', 'date_of_birth', 'ip']
const RISKS: readonly DatasetInspection['risk'][] = ['none', 'low', 'medium', 'high']
const SEVERITIES: readonly DatasetInspection['issues'][number]['severity'][] = ['info', 'warning', 'error']

/** True for a plain non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check that a value has the shape of a {@link DatasetInspection}.
 *
 * The inspection normally comes back from `dataset_inspect`, but the input is
 * model-supplied JSON, so a malformed value must become a stable tool error
 * instead of a TypeError deep inside the card renderer.
 * @param value - the candidate inspection.
 * @returns a human-readable problem, or undefined when it is structurally sound.
 */
export function inspectionProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'inspection must be an object'
  if (typeof value['label'] !== 'string') return 'inspection.label must be a string'
  if (!FORMATS.includes(value['format'] as DatasetFormat)) return 'inspection.format must be csv, tsv, json or jsonl'
  if (!Number.isFinite(value['bytes']) || (value['bytes'] as number) < 0) return 'inspection.bytes must be a non-negative number'
  if (!Number.isInteger(value['rowsScanned']) || (value['rowsScanned'] as number) < 0) return 'inspection.rowsScanned must be a non-negative integer'
  if (typeof value['truncated'] !== 'boolean') return 'inspection.truncated must be boolean'
  if (!RISKS.includes(value['risk'] as DatasetInspection['risk'])) return 'inspection.risk must be none, low, medium or high'
  if (value['license'] !== undefined && typeof value['license'] !== 'string') return 'inspection.license must be a string'
  if (value['ethics'] !== undefined && typeof value['ethics'] !== 'string') return 'inspection.ethics must be a string'
  if (!Array.isArray(value['columns'])) return 'inspection.columns must be an array'
  for (const column of value['columns']) {
    if (!isRecord(column)) return 'inspection.columns entries must be objects'
    if (typeof column['name'] !== 'string') return 'column.name must be a string'
    if (typeof column['type'] !== 'string') return 'column.type must be a string'
    if (typeof column['missingPct'] !== 'number') return 'column.missingPct must be a number'
    if (!Number.isInteger(column['cardinality']) || (column['cardinality'] as number) < 0) return 'column.cardinality must be a non-negative integer'
    if (!Array.isArray(column['pii']) || column['pii'].some(kind => !PII_KINDS.includes(kind as PiiKind))) {
      return 'column.pii must be an array of PII kinds'
    }
  }
  if (!Array.isArray(value['pii'])) return 'inspection.pii must be an array'
  for (const finding of value['pii']) {
    if (!isRecord(finding)) return 'inspection.pii entries must be objects'
    if (typeof finding['column'] !== 'string') return 'finding.column must be a string'
    if (!PII_KINDS.includes(finding['kind'] as PiiKind)) return 'finding.kind must be a PII kind'
    if (!RISKS.includes(finding['risk'] as DatasetInspection['risk'])) return 'finding.risk must be none, low, medium or high'
    if (!Number.isInteger(finding['count']) || (finding['count'] as number) < 0) return 'finding.count must be a non-negative integer'
    if (typeof finding['evidence'] !== 'string') return 'finding.evidence must be a string'
  }
  if (!Array.isArray(value['issues'])) return 'inspection.issues must be an array'
  for (const issue of value['issues']) {
    if (!isRecord(issue)) return 'inspection.issues entries must be objects'
    if (typeof issue['code'] !== 'string') return 'issue.code must be a string'
    if (!SEVERITIES.includes(issue['severity'] as DatasetInspection['issues'][number]['severity'])) {
      return 'issue.severity must be info, warning or error'
    }
    if (typeof issue['detail'] !== 'string') return 'issue.detail must be a string'
    if (typeof issue['suggestion'] !== 'string') return 'issue.suggestion must be a string'
  }
  return undefined
}
