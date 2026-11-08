/**
 * Runtime and tool surface: evidence without raw rows, card, failure branches.
 * @module test/runtime-tools.spec
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateRep } from '@perrylink/dsh-research-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import type { DatasetInspection } from '../src/inspect.ts'
import { DatasetRuntime } from '../src/runtime.ts'
import { makeDatasetCardTool } from '../src/tools/dataset-card.ts'
import { makeDatasetInspectTool } from '../src/tools/dataset-inspect.ts'
import { makeDatasetPiiTool } from '../src/tools/dataset-pii.ts'
import { VERSION } from '../src/version.ts'

const AT = new Date('2026-11-03T09:00:00.000Z')
const CSV = `id,name,email,age
1,Alice,alice@example.com,30
2,Bob,bob@example.org,41
`
let workspace: string
let store: string

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'dataset-work-'))
  store = await mkdtemp(path.join(tmpdir(), 'dataset-store-'))
  await writeFile(path.join(workspace, 'people.csv'), CSV, 'utf8')
})

afterEach(async () => {
  for (const directory of [workspace, store]) {
    if (directory.startsWith(tmpdir())) await rm(directory, { recursive: true, force: true })
  }
})

/** Build a runtime over the fixtures. */
function runtime(): DatasetRuntime {
  return new DatasetRuntime({ config: resolveConfig({ workspaceRoot: workspace, root: store }), now: () => AT })
}

const EXEC = {} as never

describe('runtime', () => {
  it('stores only the analysis, never the raw rows', async () => {
    const result = await runtime().inspect({ path: 'people.csv', license: 'CC BY 4.0', ethics: 'IRB-1' })
    expect(result.evidenceId).toMatch(/^ev-/u)
    const recordText = await readFile(result.recordPath!, 'utf8')
    expect(validateRep(JSON.parse(recordText)).ok).toBe(true)
    expect(recordText).not.toContain('alice@example.com')
    expect(recordText).not.toContain('Alice')
    expect(recordText).toContain('analysis only')
    const record = JSON.parse(recordText) as { artifacts: Array<{ kind: string; hash: string }> }
    expect(record.artifacts[0]!.kind).toBe('data')
    expect(record.artifacts[0]!.hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })

  it('rejects traversal, unsupported formats, oversize and parse errors', async () => {
    await expect(runtime().inspect({ path: '../escape.csv' })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await expect(runtime().inspect({ path: path.resolve(workspace, '..', 'outside.csv') })).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
    await writeFile(path.join(workspace, 'sheet.xlsx'), 'x', 'utf8')
    await expect(runtime().inspect({ path: 'sheet.xlsx' })).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    const tiny = new DatasetRuntime({ config: resolveConfig({ workspaceRoot: workspace, root: store, maxBytes: 10 }), now: () => AT })
    await expect(tiny.inspect({ path: 'people.csv' })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await writeFile(path.join(workspace, 'broken.json'), '{oops', 'utf8')
    await expect(runtime().inspect({ path: 'broken.json' })).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    await writeFile(path.join(workspace, 'nulls.json'), '[null]', 'utf8')
    await expect(runtime().inspect({ path: 'nulls.json' })).rejects.toMatchObject({ code: 'PARSE_ERROR' })
    await writeFile(path.join(workspace, 'scalar.jsonl'), '42\n', 'utf8')
    await expect(runtime().inspect({ path: 'scalar.jsonl' })).rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })
})

describe('tools', () => {
  it('declares names and schemas', () => {
    for (const [tool, name] of [
      [makeDatasetInspectTool(runtime()), 'dataset_inspect'],
      [makeDatasetPiiTool(), 'dataset_pii'],
      [makeDatasetCardTool(runtime()), 'dataset_card'],
    ] as const) {
      expect(tool.name).toBe(name)
      expect(Object.keys(tool.parameters).length).toBeGreaterThan(0)
      expect(tool.output.schema).toBeDefined()
    }
  })

  it('inspect → pii → card end to end', async () => {
    const inspected = (await makeDatasetInspectTool(runtime()).execute({ path: 'people.csv', license: 'CC BY 4.0', ethics: 'IRB-1' }, EXEC)) as {
      ok: true
      inspection: DatasetInspection
    }
    expect(inspected.ok).toBe(true)

    const pii = (await makeDatasetPiiTool().execute({ inspection: inspected.inspection }, EXEC)) as {
      ok: true
      summary: { risk: string; recommendations: string[] }
    }
    expect(pii.summary.risk).toBe('high')
    expect(pii.summary.recommendations.length).toBeGreaterThan(0)

    const card = (await makeDatasetCardTool(runtime()).execute(
      { inspection: inspected.inspection, title: 'People', motivation: 'Testing', composition: 'Synthetic people', license: 'CC BY 4.0', ethics: 'IRB-1' },
      EXEC,
    )) as { ok: true; markdown: string; card: { missingSections: string[] }; sarif: { version: string; runs: Array<{ results: unknown[] }> } }
    expect(card.markdown).toContain('Dataset card: People')
    expect(card.markdown).toContain('Privacy findings (redacted)')
    expect(card.card.missingSections).not.toContain('Motivation')
    expect(card.sarif.version).toBe('2.1.0')
    expect(card.sarif.runs[0]!.results.length).toBeGreaterThan(0)
  })

  it('failure branches carry stable codes', async () => {
    const value = (await makeDatasetInspectTool(runtime()).execute({ path: '' }, EXEC)) as { ok: false; error: { code: string } }
    expect(value.ok).toBe(false)
    expect(value.error.code).toBe('INVALID_INPUT')
    const noInspection = (await makeDatasetCardTool(runtime()).execute({ inspection: {} }, EXEC)) as { ok: false; error: { code: string } }
    expect(noInspection.error.code).toBe('INVALID_INPUT')
  })

  it('rejects a malformed inspection instead of throwing in the renderer', async () => {
    const inspected = (await makeDatasetInspectTool(runtime()).execute(
      { path: 'people.csv', license: 'CC BY 4.0', ethics: 'IRB-1' },
      EXEC,
    )) as { ok: true; inspection: DatasetInspection }
    const badPii = (await makeDatasetPiiTool().execute(
      { inspection: { ...inspected.inspection, pii: [null] } },
      EXEC,
    )) as { ok: false; error: { code: string } }
    expect(badPii.error.code).toBe('INVALID_INPUT')
    const badCard = (await makeDatasetCardTool(runtime()).execute(
      { inspection: { ...inspected.inspection, columns: [null] } },
      EXEC,
    )) as { ok: false; error: { code: string } }
    expect(badCard.error.code).toBe('INVALID_INPUT')
  })
})

describe('package', () => {
  it('VERSION matches package.json and the manifest declares a bundle patch', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(pkg['version']).toBe(VERSION)
    expect(pkg['dsh']).toEqual({ manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } })
    expect(pkg['dependencies']).toEqual({})
  })
})
