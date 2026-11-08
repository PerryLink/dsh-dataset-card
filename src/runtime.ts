/**
 * Runtime: workspace-safe dataset loading, inspection, evidence and cards.
 *
 * Only the analysis is stored as evidence — never the raw rows — because the
 * dataset may contain personal data. The dataset file itself is represented by
 * a sha256 artifact.
 *
 * @module dsh-dataset-card/runtime
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  EvidenceStore,
  RepStoreError,
  sha256Hex,
  stableId,
  validateRep,
  type AddEvidenceInput,
  type Artifact,
  type CaptureInput,
  type CheckResult,
  type Evidence,
  type ResearchRecord,
  type Snapshot,
} from '@perrylink/dsh-research-core'
import type { ResolvedConfig } from './config.ts'
import { buildCard, renderCardSarif, type CardInput, type DatasetCard } from './card.ts'
import { inspectDataset, type DatasetFormat, type DatasetInspection } from './inspect.ts'
import { TableError } from './table.ts'
import { VERSION } from './version.ts'

/** Stable error codes. */
export type DcErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'PATH_ESCAPE' | 'NOT_A_FILE' | 'TOO_LARGE' | 'UNSUPPORTED_FORMAT' | 'PARSE_ERROR' | 'STORE_ERROR'

/** A typed failure. */
export class DcError extends Error {
  /** Stable code. */
  readonly code: DcErrorCode

  constructor(code: DcErrorCode, message: string) {
    super(message)
    this.name = 'DcError'
    this.code = code
  }
}

/** The subset of the REP service used here. */
export interface EvidencePort {
  capture(input: CaptureInput): Promise<{ snapshot: Snapshot }>
  addEvidence(input: AddEvidenceInput): Promise<{ evidence: Evidence }>
  buildRecord(options?: { evidenceIds?: readonly string[]; artifacts?: readonly Artifact[] }): Promise<Omit<ResearchRecord, 'manifest'>>
}

/** Inspection with evidence. */
export interface InspectValue {
  readonly inspection: DatasetInspection
  readonly evidenceId?: string
  readonly recordPath?: string
}

/** Runtime options. */
export interface DcRuntimeOptions {
  readonly config: ResolvedConfig
  readonly service?: EvidencePort
  readonly now?: () => Date
}

/** True when `candidate` is inside `root`. */
function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
}

/** Map an extension to a format. */
export function formatOf(file: string): DatasetFormat {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.csv') return 'csv'
  if (extension === '.tsv' || extension === '.tab') return 'tsv'
  if (extension === '.json') return 'json'
  if (extension === '.jsonl' || extension === '.ndjson') return 'jsonl'
  throw new DcError('UNSUPPORTED_FORMAT', `unsupported dataset extension "${extension}"; use .csv, .tsv, .json or .jsonl`)
}

/** The runtime. */
export class DatasetRuntime {
  readonly config: ResolvedConfig

  readonly #service: EvidencePort | undefined
  readonly #now: () => Date
  #store: EvidenceStore | undefined

  constructor(options: DcRuntimeOptions) {
    this.config = options.config
    this.#service = options.service
    this.#now = options.now ?? (() => new Date())
  }

  /** Current ISO timestamp. */
  iso(): string {
    return this.#now().toISOString()
  }

  /** The evidence port. */
  port(): EvidencePort {
    if (this.#service !== undefined) return this.#service
    this.#store ??= new EvidenceStore(path.join(this.config.root, 'store'))
    return this.#store
  }

  /** Resolve a dataset file inside the workspace. */
  async resolve(input: string): Promise<{ absolute: string; id: string; bytes: number }> {
    if (typeof input !== 'string' || input.trim() === '') throw new DcError('INVALID_INPUT', 'path must be a non-empty string')
    let realRoot: string
    try {
      realRoot = await realpath(this.config.workspaceRoot)
    } catch {
      throw new DcError('NOT_FOUND', `workspace root does not exist: ${this.config.workspaceRoot}`)
    }
    const candidate = path.resolve(realRoot, input)
    if (!isInside(realRoot, candidate)) throw new DcError('PATH_ESCAPE', 'path resolves outside the workspace root')
    let real: string
    try {
      real = await realpath(candidate)
    } catch {
      throw new DcError('NOT_FOUND', `dataset not found: ${input}`)
    }
    if (!isInside(realRoot, real)) throw new DcError('PATH_ESCAPE', 'path escapes the workspace root through a symlink')
    const info = await stat(real)
    if (!info.isFile()) throw new DcError('NOT_A_FILE', `not a regular file: ${input}`)
    if (info.size > this.config.maxBytes) throw new DcError('TOO_LARGE', `dataset is ${info.size} bytes, the cap is ${this.config.maxBytes}`)
    return { absolute: real, id: path.relative(realRoot, real).split(path.sep).join('/'), bytes: info.size }
  }

  /**
   * Inspect a dataset file.
   * @param request - path, license/ethics metadata and persistence.
   * @returns the inspection and evidence ids.
   */
  async inspect(request: { path?: string; label?: string; license?: string; ethics?: string; persist?: boolean }): Promise<InspectValue> {
    if (typeof request.path !== 'string') throw new DcError('INVALID_INPUT', 'path is required')
    const file = await this.resolve(request.path)
    const format = formatOf(file.absolute)
    const body = await readFile(file.absolute, 'utf8')
    let inspection: DatasetInspection
    try {
      inspection = inspectDataset(
        { label: request.label ?? file.id, format, bytes: file.bytes, body },
        { maxRows: this.config.maxRows, ...(request.license === undefined ? {} : { license: request.license }), ...(request.ethics === undefined ? {} : { ethics: request.ethics }) },
      )
    } catch (error) {
      if (error instanceof TableError) throw new DcError('PARSE_ERROR', error.message)
      if (error instanceof SyntaxError) throw new DcError('PARSE_ERROR', `invalid JSON: ${error.message}`)
      throw error
    }
    const persist = request.persist ?? this.config.persist
    if (!persist) return { inspection }
    const checks: CheckResult[] = [
      {
        checkId: 'chk-dc-rows',
        check: 'other',
        status: 'pass',
        severity: 'info',
        detail: `scanned ${inspection.rowsScanned} row(s)${inspection.truncated ? ' (truncated)' : ''}`,
      },
      ...inspection.issues.map((issue, index) => ({
        checkId: `chk-dc-${index + 1}`,
        check: 'other' as const,
        status: issue.severity === 'error' ? ('fail' as const) : issue.severity === 'warning' ? ('warn' as const) : ('pass' as const),
        severity: issue.severity === 'error' ? ('error' as const) : issue.severity === 'warning' ? ('warning' as const) : ('info' as const),
        detail: `${issue.code}: ${issue.detail}`,
        ...(issue.code === 'pii_without_ethics' ? { actual: { risk: inspection.risk, pii: inspection.pii.map(finding => ({ column: finding.column, kind: finding.kind, risk: finding.risk })) } } : {}),
      })),
    ]
    const datasetHash = `sha256:${createHash('sha256').update(await readFile(file.absolute)).digest('hex')}`
    const artifacts: Artifact[] = [{ artifactId: stableId('art', ['dataset', file.id]), kind: 'data', path: file.id, hash: datasetHash as `sha256:${string}`, description: 'dataset file (hash only; contents not stored)' }]
    const port = this.port()
    try {
      const captured = await port.capture({
        bytes: JSON.stringify(inspection),
        mediaType: 'application/json',
        sourceRef: { kind: 'file', id: file.id, retrievedAt: this.iso() },
        capturedAt: this.iso(),
      })
      const evidence = (
        await port.addEvidence({
          evidenceId: stableId('ev', ['dataset-card', file.id, captured.snapshot.snapshotId]),
          title: `Dataset inspection: ${inspection.label}`,
          sourceRef: { kind: 'file', id: file.id, retrievedAt: this.iso() },
          snapshotIds: [captured.snapshot.snapshotId],
          anchors: [{ snapshotId: captured.snapshot.snapshotId, kind: 'record', value: 'field:columns', label: sha256Hex(JSON.stringify(inspection)) }],
          provenance: { plugin: 'dsh-dataset-card', version: VERSION, method: 'profile-no-raw-values', retrievedAt: this.iso() },
          checks,
          notes: `analysis only (no raw rows stored); dataset ${datasetHash}; privacy risk ${inspection.risk}`,
        })
      ).evidence
      const record = await port.buildRecord({ evidenceIds: [evidence.evidenceId], artifacts })
      if (!validateRep(record).ok) throw new DcError('STORE_ERROR', 'refusing to write an invalid REP record')
      const directory = path.join(this.config.root, 'records')
      await mkdir(directory, { recursive: true })
      const recordPath = path.join(directory, `${evidence.evidenceId}.rep.json`)
      await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
      return { inspection, evidenceId: evidence.evidenceId, recordPath }
    } catch (error) {
      if (error instanceof DcError) throw error
      if (error instanceof RepStoreError) throw new DcError('STORE_ERROR', error.message)
      throw new DcError('STORE_ERROR', `could not store the inspection: ${(error as Error).message}`)
    }
  }

  /**
   * Build a dataset card.
   * @param inspection - an inspection.
   * @param input - Datasheet metadata.
   * @returns the card.
   */
  card(inspection: DatasetInspection, input: CardInput = {}): DatasetCard & { sarif: Record<string, unknown> } {
    const card = buildCard(inspection, input)
    return { ...card, sarif: renderCardSarif(card, VERSION) }
  }
}
