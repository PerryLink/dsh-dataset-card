/**
 * Datasheet-style dataset card: Markdown + JSON, with missing-section warnings.
 * @module dsh-dataset-card/card
 */

import type { DatasetInspection } from './inspect.ts'

/** Card metadata supplied by the user (Datasheet sections). */
export interface CardInput {
  readonly title?: string
  readonly description?: string
  readonly creators?: string
  readonly license?: string
  readonly ethics?: string
  readonly doi?: string
  readonly motivation?: string
  readonly composition?: string
  readonly collection?: string
  readonly preprocessing?: string
  readonly uses?: string
  readonly distribution?: string
  readonly maintenance?: string
}

/** Rendered card. */
export interface DatasetCard {
  readonly title: string
  readonly input: CardInput
  readonly inspection: DatasetInspection
  readonly missingSections: readonly string[]
  readonly markdown: string
}

/** Section definitions. */
const SECTIONS: ReadonlyArray<{ key: keyof CardInput; title: string; hint: string }> = [
  { key: 'motivation', title: 'Motivation', hint: 'why the dataset was created, who funded it, for what task' },
  { key: 'composition', title: 'Composition', hint: 'instances, variables, missing data, sensitive content' },
  { key: 'collection', title: 'Collection process', hint: 'how data were acquired, consent and ethics approval' },
  { key: 'preprocessing', title: 'Preprocessing / cleaning', hint: 'de-identification, exclusions, transformations' },
  { key: 'uses', title: 'Uses', hint: 'intended tasks, known limitations, unsuitable uses' },
  { key: 'distribution', title: 'Distribution', hint: 'license, access conditions, DOI, repository' },
  { key: 'maintenance', title: 'Maintenance', hint: 'maintainer, contact, update policy' },
]

/**
 * Build a dataset card.
 * @param inspection - the dataset inspection.
 * @param input - metadata supplied by the user.
 * @returns the card JSON and Markdown.
 */
export function buildCard(inspection: DatasetInspection, input: CardInput = {}): DatasetCard {
  const missingSections = SECTIONS.filter(section => input[section.key] === undefined || String(input[section.key]).trim() === '').map(section => section.title)
  const lines = [`# Dataset card: ${input.title ?? inspection.label}`, '']
  if (input.description !== undefined) lines.push(input.description, '')
  lines.push('| Field | Value |')
  lines.push('|---|---|')
  lines.push(`| File | \`${inspection.label}\` (${inspection.format}, ${inspection.bytes} bytes) |`)
  lines.push(`| Rows scanned | ${inspection.rowsScanned}${inspection.truncated ? ' (truncated)' : ''} |`)
  lines.push(`| Columns | ${inspection.columns.length} |`)
  lines.push(`| License | ${input.license ?? inspection.license ?? 'not declared'} |`)
  lines.push(`| Ethics | ${input.ethics ?? inspection.ethics ?? 'not declared'} |`)
  if (input.doi !== undefined) lines.push(`| DOI | ${input.doi} |`)
  if (input.creators !== undefined) lines.push(`| Creators | ${input.creators} |`)
  lines.push('')
  lines.push('## Composition')
  lines.push('')
  if (input.composition !== undefined) lines.push(input.composition, '')
  lines.push('| Column | Type | Missing | Distinct (sample) | PII |')
  lines.push('|---|---|---:|---:|---|')
  for (const column of inspection.columns) {
    lines.push(`| ${column.name} | ${column.type} | ${column.missingPct}% | ${column.cardinality} | ${column.pii.length === 0 ? '—' : column.pii.join(', ')} |`)
  }
  lines.push('')
  if (inspection.pii.length > 0) {
    lines.push('## Privacy findings (redacted)')
    lines.push('')
    lines.push('| Column | Kind | Risk | Count | Evidence |')
    lines.push('|---|---|---|---:|---|')
    for (const finding of inspection.pii) lines.push(`| ${finding.column} | ${finding.kind} | ${finding.risk} | ${finding.count} | ${finding.evidence} |`)
    lines.push('')
    lines.push('> Evidence is redacted at the pattern level; raw values are never written into the card.')
    lines.push('')
  }
  for (const section of SECTIONS) {
    if (section.key === 'composition') continue
    const value = input[section.key]
    lines.push(`## ${section.title}`)
    lines.push('')
    lines.push(value === undefined || String(value).trim() === '' ? `_Not provided._ (${section.hint})` : String(value))
    lines.push('')
  }
  if (inspection.issues.length > 0) {
    lines.push('## Issues')
    lines.push('')
    for (const issue of inspection.issues) lines.push(`- **${issue.severity}** ${issue.code}: ${issue.detail} — ${issue.suggestion}`)
    lines.push('')
  }
  return {
    title: input.title ?? inspection.label,
    input,
    inspection,
    missingSections,
    markdown: `${lines.join('\n')}\n`,
  }
}

/**
 * Render card gaps as SARIF 2.1.0.
 * @param card - the card.
 * @param version - plugin version.
 * @returns the SARIF log.
 */
export function renderCardSarif(card: DatasetCard, version: string): Record<string, unknown> {
  const results: Array<Record<string, unknown>> = []
  for (const section of card.missingSections) {
    results.push({ ruleId: 'dataset-card/missing-section', level: 'warning', message: { text: `Datasheet section not provided: ${section}` } })
  }
  for (const issue of card.inspection.issues) {
    results.push({ ruleId: `dataset-card/${issue.code}`, level: issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'note', message: { text: `${issue.detail} — ${issue.suggestion}` } })
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'dsh-dataset-card', version } }, results }],
  }
}
