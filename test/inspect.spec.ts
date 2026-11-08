/**
 * Table parsing, type inference, profiling and PII redaction.
 * @module test/inspect.spec
 */

import { describe, expect, it } from 'vitest'
import { inspectDataset } from '../src/inspect.ts'
import { inferType, parseDelimited } from '../src/table.ts'

const CSV = `id,name,email,age
1,Alice,alice@example.com,30
2,Bob,bob@example.org,41
3,Carol,carol@example.net,
4,Dan,dan@example.com,55
5,Eve,eve@example.org,29
`

describe('delimited parsing', () => {
  it('handles quoted fields, escaped quotes and embedded newlines', () => {
    const rows = parseDelimited('a,b\n"x, y","he said ""hi"""\n"line1\nline2",z\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['x, y', 'he said "hi"'])
    expect(rows[2]![0]).toBe('line1\nline2')
  })

  it('infers column types', () => {
    expect(inferType(['1', '2', '3'])).toBe('integer')
    expect(inferType(['1.5', '2', '3e2'])).toBe('number')
    expect(inferType(['true', 'false'])).toBe('boolean')
    expect(inferType(['2024-01-01', '2024-02-03'])).toBe('date')
    expect(inferType(['a', 'b'])).toBe('string')
  })
})

describe('inspection', () => {
  it('profiles columns, missingness and PII risk without leaking values', () => {
    const inspection = inspectDataset({ label: 'people.csv', format: 'csv', bytes: CSV.length, body: CSV }, { maxRows: 100, license: 'CC BY 4.0', ethics: 'IRB-123' })
    expect(inspection.rowsScanned).toBe(5)
    expect(inspection.columns.map(column => column.name)).toEqual(['id', 'name', 'email', 'age'])
    expect(inspection.columns.find(column => column.name === 'age')?.missingPct).toBe(20)
    expect(inspection.risk).toBe('high')
    expect(inspection.pii.some(finding => finding.kind === 'email' && finding.column === 'email')).toBe(true)
    expect(inspection.pii.some(finding => finding.kind === 'name' && finding.column === 'name')).toBe(true)
    for (const finding of inspection.pii) {
      expect(finding.evidence).not.toContain('alice@example.com')
      expect(finding.evidence).not.toContain('Alice')
    }
  })

  it('flags a missing license and PII without an ethics statement', () => {
    const inspection = inspectDataset({ label: 'people.csv', format: 'csv', bytes: CSV.length, body: CSV }, { maxRows: 100 })
    expect(inspection.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['no_license', 'pii_without_ethics']))
    expect(inspection.issues.find(issue => issue.code === 'pii_without_ethics')?.severity).toBe('error')
  })

  it('parses JSON arrays and TSV', () => {
    const json = JSON.stringify([{ id: 1, score: 3.5 }, { id: 2, score: 4 }])
    const fromJson = inspectDataset({ label: 'scores.json', format: 'json', bytes: json.length, body: json }, { maxRows: 100, license: 'MIT', ethics: 'none' })
    expect(fromJson.columns.map(column => column.name)).toEqual(['id', 'score'])
    expect(fromJson.columns.find(column => column.name === 'score')?.type).toBe('number')

    const tsv = 'a\tb\n1\t2\n'
    const fromTsv = inspectDataset({ label: 'x.tsv', format: 'tsv', bytes: tsv.length, body: tsv }, { maxRows: 100, license: 'MIT', ethics: 'none' })
    expect(fromTsv.columns).toHaveLength(2)
  })

  it('caps rows and says so', () => {
    const inspection = inspectDataset({ label: 'people.csv', format: 'csv', bytes: CSV.length, body: CSV }, { maxRows: 2, license: 'CC BY 4.0', ethics: 'IRB-123' })
    expect(inspection.rowsScanned).toBe(2)
    expect(inspection.truncated).toBe(true)
    expect(inspection.issues.some(issue => issue.code === 'scan_truncated')).toBe(true)
  })
})
