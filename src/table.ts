/**
 * Minimal delimited-text parser (CSV/TSV), quote-aware.
 *
 * It intentionally does not try to be a full RFC 4180 implementation: quoted
 * fields with escaped quotes and embedded newlines are supported, everything
 * else is treated literally. Malformed rows are reported, never silently
 * repaired.
 *
 * @module dsh-dataset-card/table
 */

/** Parse failure. */
export class TableError extends Error {
  /** Stable code. */
  readonly code: 'EMPTY' | 'UNTERMINATED_QUOTE'
  constructor(code: 'EMPTY' | 'UNTERMINATED_QUOTE', message: string) {
    super(message)
    this.name = 'TableError'
    this.code = code
  }
}

/** Parse a delimited text into rows of strings. */
export function parseDelimited(text: string, delimiter: ',' | '\t' = ','): string[][] {
  if (text.trim() === '') throw new TableError('EMPTY', 'the file is empty')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field === '') {
      inQuotes = true
    } else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (character === '\r') {
      // Ignore CR; the following LF ends the row.
    } else {
      field += character
    }
  }
  if (inQuotes) throw new TableError('UNTERMINATED_QUOTE', 'a quoted field is never closed')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(candidate => candidate.length > 0)
}

/** Infer a column type from sample values. */
export function inferType(values: readonly string[]): 'integer' | 'number' | 'boolean' | 'date' | 'string' {
  const present = values.filter(value => value !== '' && value.toLowerCase() !== 'na' && value.toLowerCase() !== 'null')
  if (present.length === 0) return 'string'
  if (present.every(value => /^-?\d+$/u.test(value.trim()))) return 'integer'
  if (present.every(value => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/u.test(value.trim()))) return 'number'
  if (present.every(value => /^(true|false|0|1)$/iu.test(value.trim()))) return 'boolean'
  if (present.every(value => /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/u.test(value.trim()))) return 'date'
  return 'string'
}
