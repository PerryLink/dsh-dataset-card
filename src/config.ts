/**
 * Config schema and resolution for `dsh-dataset-card`.
 * @module dsh-dataset-card/config
 */

import path from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Raw plugin config. */
export interface Config {
  enabled?: boolean
  root?: string
  workspaceRoot?: string
  maxBytes?: number
  maxRows?: number
  persist?: boolean
}

/** Fully resolved config. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly root: string
  readonly workspaceRoot: string
  readonly maxBytes: number
  readonly maxRows: number
  readonly persist: boolean
}

/** Schemastery schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  root: z.string().default('.dataset-card'),
  workspaceRoot: z.string(),
  maxBytes: z.number().default(20 * 1024 * 1024),
  maxRows: z.number().default(10_000),
  persist: z.boolean().default(true),
})

/** Throw unless the value is a positive safe integer. */
function assertPositiveInt(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer, got ${String(value)}`)
}

/**
 * Validate raw values and fill explicit defaults.
 * @param config - raw plugin config.
 * @returns the fully resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const root = config.root ?? '.dataset-card'
  if (typeof root !== 'string' || root.trim() === '') throw new TypeError('root must be a non-empty path')
  const maxBytes = config.maxBytes ?? 20 * 1024 * 1024
  const maxRows = config.maxRows ?? 10_000
  for (const [name, value] of Object.entries({ maxBytes, maxRows })) assertPositiveInt(name, value)
  return {
    enabled: config.enabled ?? true,
    root: path.resolve(root),
    workspaceRoot: path.resolve(config.workspaceRoot ?? process.cwd()),
    maxBytes,
    maxRows,
    persist: config.persist ?? true,
  }
}
