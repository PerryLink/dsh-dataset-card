/**
 * Dataset inspection: columns, types, missingness, cardinality and PII risks.
 *
 * Privacy rule: the inspection never copies raw cell values into its output.
 * PII evidence is redacted at the pattern level (`***@***.com`), and only the
 * analysis (not the data) may be stored as evidence.
 *
 * @module dsh-dataset-card/inspect
 */

import { inferType, parseDelimited, TableError } from './table.ts'

/** Supported formats. */
export type DatasetFormat = 'csv' | 'tsv' | 'json' | 'jsonl'

/** PII kinds. */
export type PiiKind = 'name' | 'email' | 'phone' | 'identifier' | 'address' | 'date_of_birth' | 'ip'

/** One PII finding (always redacted). */
export interface PiiFinding {
  readonly column: string
  readonly kind: PiiKind
  readonly risk: 'high' | 'medium' | 'low'
  readonly count: number
  /** Redacted evidence; never a raw value. */
  readonly evidence: string
}

/** Column profile. */
export interface ColumnProfile {
  readonly name: string
  readonly type: ReturnType<typeof inferType>
  readonly missingPct: number
  /** Distinct values seen in the scan window. */
  readonly cardinality: number
  readonly pii: readonly PiiKind[]
}

/** One issue. */
export interface DatasetIssue {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly detail: string
  readonly suggestion: string
}

/** Inspection result. */
export interface DatasetInspection {
  readonly label: string
  readonly format: DatasetFormat
  readonly bytes: number
  readonly rowsScanned: number
  readonly truncated: boolean
  readonly columns: readonly ColumnProfile[]
  readonly pii: readonly PiiFinding[]
  readonly license?: string
  readonly ethics?: string
  readonly issues: readonly DatasetIssue[]
  readonly risk: 'none' | 'low' | 'medium' | 'high'
}

/** Column-name heuristics. */
const NAME_RULES: ReadonlyArray<{ kind: PiiKind; risk: PiiFinding['risk']; pattern: RegExp }> = [
  { kind: 'email', risk: 'high', pattern: /e[-_]?mail|邮箱|邮件/iu },
  { kind: 'phone', risk: 'high', pattern: /phone|mobile|tel(?:ephone)?|手机|电话/iu },
  { kind: 'identifier', risk: 'high', pattern: /^(?:patient|subject|participant)?[_-]?id$|uuid|ssn|national[_-]?id|mrn|学号|身份证/iu },
  { kind: 'name', risk: 'medium', pattern: /^(?:full[_-]?name|name|first[_-]?name|last[_-]?name|surname|given[_-]?name|姓名|名字)$/iu },
  { kind: 'address', risk: 'medium', pattern: /address|street|postal|zip|地址/iu },
  { kind: 'date_of_birth', risk: 'medium', pattern: /dob|birth|出生/iu },
  { kind: 'ip', risk: 'low', pattern: /ip(?:[_-]?address)?$/iu },
]

/** Value patterns and their redaction. */
const VALUE_RULES: ReadonlyArray<{ kind: PiiKind; pattern: RegExp; redact: (match: string) => string }> = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, redact: () => '***@***.***' },
  { kind: 'phone', pattern: /(?:\+?86[- ]?)?1[3-9]\d{9}\b/gu, redact: () => '1**********' },
  { kind: 'phone', pattern: /\+?\d[\d -]{7,}\d/gu, redact: () => '********' },
  { kind: 'identifier', pattern: /\b\d{17}[\dXx]\b/gu, redact: () => '*****************' },
  { kind: 'ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, redact: () => '***.***.***.***' },
]

/** Detect PII in one column's name and values. */
export function detectPii(column: string, values: readonly string[]): PiiFinding[] {
  const findings: PiiFinding[] = []
  const byName = NAME_RULES.find(rule => rule.pattern.test(column))
  if (byName !== undefined) {
    const columnName = byName.kind === 'identifier' && /id$/iu.test(column) && !/patient|subject|participant|uuid|ssn|mrn/iu.test(column) ? 'identifier' : byName.kind
    findings.push({ column, kind: columnName, risk: byName.risk, count: values.filter(value => value.trim() !== '').length, evidence: `column name matches ${byName.kind} pattern` })
  }
  for (const rule of VALUE_RULES) {
    if (findings.some(finding => finding.kind === rule.kind)) continue
    let count = 0
    let redacted = ''
    for (const value of values) {
      rule.pattern.lastIndex = 0
      const match = rule.pattern.exec(value)
      if (match === null) continue
      count += 1
      if (redacted === '') redacted = rule.redact(match[0])
    }
    if (count > 0) findings.push({ column, kind: rule.kind, risk: rule.kind === 'email' || rule.kind === 'identifier' ? 'high' : 'medium', count, evidence: redacted })
  }
  return findings
}

/** Compute the aggregate privacy risk. */
export function riskOf(pii: readonly PiiFinding[]): DatasetInspection['risk'] {
  if (pii.some(finding => finding.risk === 'high')) return 'high'
  if (pii.some(finding => finding.risk === 'medium')) return 'medium'
  if (pii.length > 0) return 'low'
  return 'none'
}

/** Parse a file body into columns and rows. */
export function parseDataset(body: string, format: DatasetFormat, maxRows: number): { columns: string[]; rows: string[][]; truncated: boolean } {
  if (format === 'csv' || format === 'tsv') {
    const rows = parseDelimited(body, format === 'csv' ? ',' : '\t')
    if (rows.length === 0) throw new TableError('EMPTY', 'the table has no rows')
    const header = rows[0]!
    const data = rows.slice(1, maxRows + 1)
    return { columns: header, rows: data, truncated: rows.length - 1 > maxRows }
  }
  if (format === 'json') {
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) throw new TableError('EMPTY', 'JSON datasets must be an array of objects')
    if (parsed.some(object => typeof object !== 'object' || object === null || Array.isArray(object))) {
      throw new TableError('INVALID_SHAPE', 'JSON datasets must be an array of objects')
    }
    const objects = parsed.slice(0, maxRows) as Array<Record<string, unknown>>
    const columns = [...new Set(objects.flatMap(object => Object.keys(object)))]
    return { columns, rows: objects.map(object => columns.map(column => object[column] === undefined ? '' : String(object[column]))), truncated: parsed.length > maxRows }
  }
  const lines = body.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) throw new TableError('EMPTY', 'the JSONL file is empty')
  const objects = lines.slice(0, maxRows).map((line, index) => {
    const object = JSON.parse(line) as unknown
    if (typeof object !== 'object' || object === null || Array.isArray(object)) {
      throw new TableError('INVALID_SHAPE', `JSONL line ${String(index + 1)} must be a JSON object`)
    }
    return object as Record<string, unknown>
  })
  const columns = [...new Set(objects.flatMap(object => Object.keys(object)))]
  return { columns, rows: objects.map(object => columns.map(column => object[column] === undefined ? '' : String(object[column]))), truncated: lines.length > maxRows }
}

/**
 * Inspect a dataset.
 * @param input - label, format, bytes and body.
 * @param options - row cap, license and ethics metadata.
 * @returns column profiles, PII findings and issues.
 */
export function inspectDataset(
  input: { label: string; format: DatasetFormat; bytes: number; body: string },
  options: { maxRows: number; license?: string; ethics?: string },
): DatasetInspection {
  const { columns, rows, truncated } = parseDataset(input.body, input.format, options.maxRows)
  const profiles: ColumnProfile[] = columns.map((name, index) => {
    const values = rows.map(row => row[index] ?? '')
    const present = values.filter(value => value !== '')
    const unique = new Set(present).size
    const missingPct = values.length === 0 ? 100 : Number((((values.length - present.length) / values.length) * 100).toFixed(2))
    return {
      name,
      type: inferType(values),
      missingPct,
      cardinality: unique,
      pii: detectPii(name, values).map(finding => finding.kind),
    }
  })
  const pii = columns.flatMap((name, index) => detectPii(name, rows.map(row => row[index] ?? '')))
  const risk = riskOf(pii)
  const issues: DatasetIssue[] = []
  if (options.license === undefined || options.license.trim() === '') {
    issues.push({ code: 'no_license', severity: 'warning', detail: 'no license was declared for the dataset', suggestion: 'state the license (e.g. CC BY 4.0) or why redistribution is restricted' })
  }
  if (risk !== 'none' && (options.ethics === undefined || options.ethics.trim() === '')) {
    issues.push({ code: 'pii_without_ethics', severity: 'error', detail: `PII-like columns were detected (risk ${risk}) but no ethics/consent statement was supplied`, suggestion: 'record the ethics approval, consent basis and de-identification performed' })
  }
  if (columns.length === 0) issues.push({ code: 'no_columns', severity: 'error', detail: 'no columns were parsed', suggestion: 'check the delimiter and header row' })
  if (new Set(columns).size !== columns.length) issues.push({ code: 'duplicate_columns', severity: 'warning', detail: 'duplicate column names were found', suggestion: 'rename columns to be unique' })
  if (truncated) issues.push({ code: 'scan_truncated', severity: 'info', detail: `only the first ${options.maxRows} rows were scanned`, suggestion: 'raise maxRows for a full profile; the profile is a sample, not a full audit' })
  if (rows.length === 0) issues.push({ code: 'no_rows', severity: 'warning', detail: 'the dataset has a header but no data rows', suggestion: 'confirm the file is complete' })
  return {
    label: input.label,
    format: input.format,
    bytes: input.bytes,
    rowsScanned: rows.length,
    truncated,
    columns: profiles,
    pii,
    ...(options.license === undefined ? {} : { license: options.license }),
    ...(options.ethics === undefined ? {} : { ethics: options.ethics }),
    issues,
    risk,
  }
}
