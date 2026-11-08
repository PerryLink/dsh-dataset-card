/**
 * `dsh-dataset-card` — dataset profile, redacted PII scan and Datasheet export.
 *
 * Three tools: dataset_inspect, dataset_pii, dataset_card. Only the analysis is
 * stored as evidence; the raw rows never are.
 *
 * Function plugin — no default export.
 * @module dsh-dataset-card
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveConfig, type Config as ConfigShape } from './config.ts'
import { DatasetRuntime, type EvidencePort } from './runtime.ts'
import { makeDatasetCardTool } from './tools/dataset-card.ts'
import { makeDatasetInspectTool } from './tools/dataset-inspect.ts'
import { makeDatasetPiiTool } from './tools/dataset-pii.ts'

/** Cordis plugin name. */
export const name = 'dataset-card'

/** The tool registry is required; the REP service is optional. */
export const inject = ['tools']

export { Config, resolveConfig }
export type { ConfigShape }
export type { ResolvedConfig } from './config.ts'
export { VERSION } from './version.ts'
export { buildCard, renderCardSarif } from './card.ts'
export type { CardInput, DatasetCard } from './card.ts'
export { detectPii, inspectDataset, parseDataset, riskOf } from './inspect.ts'
export type { ColumnProfile, DatasetFormat, DatasetInspection, DatasetIssue, PiiFinding, PiiKind } from './inspect.ts'
export { inferType, parseDelimited, TableError } from './table.ts'
export { DatasetRuntime, DcError, formatOf } from './runtime.ts'
export type { DcErrorCode, DcRuntimeOptions, EvidencePort, InspectValue } from './runtime.ts'
export { makeDatasetInspectTool } from './tools/dataset-inspect.ts'
export { makeDatasetPiiTool } from './tools/dataset-pii.ts'
export { makeDatasetCardTool } from './tools/dataset-card.ts'

/**
 * Mount the three tools.
 * @param ctx - the plugin context (host).
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('dataset-card')
  if (!resolved.enabled) {
    logger.info('disabled: enabled is false — no tools are mounted')
    return
  }
  const service = ctx.get('researchEvidence') as EvidencePort | undefined
  const runtime = new DatasetRuntime({ config: resolved, ...(service === undefined ? {} : { service }) })
  if (service === undefined) {
    logger.info(`ctx.researchEvidence is not mounted; using a local core store under ${resolved.root}`)
  }
  ctx.effect(() => ctx.tools.register(makeDatasetInspectTool(runtime)), 'dataset-card: dataset_inspect tool')
  ctx.effect(() => ctx.tools.register(makeDatasetPiiTool()), 'dataset-card: dataset_pii tool')
  ctx.effect(() => ctx.tools.register(makeDatasetCardTool(runtime)), 'dataset-card: dataset_card tool')
}
