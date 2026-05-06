// Central registry of repertory parsers. Adding a new book format means:
//   1. write a parser file under services/parsers/
//   2. import it here and call registerParser(...)
// Nothing else in the upload pipeline needs to change.

import type { RepertoryParser } from './parser.types'
import { completeTabParser } from './completeTab'
import { jeremyQRepParser } from './jeremyQRep'
import { murphyRtfParser } from './murphyRtf'

const registry = new Map<string, RepertoryParser>()

export function registerParser(parser: RepertoryParser): void {
  if (registry.has(parser.id)) {
    throw new Error(`Parser already registered: ${parser.id}`)
  }
  registry.set(parser.id, parser)
}

export function getParser(id: string): RepertoryParser | null {
  return registry.get(id) ?? null
}

export function getParserOrThrow(id: string): RepertoryParser {
  const p = registry.get(id)
  if (!p) throw new Error(`Unknown parser_type: ${id}`)
  return p
}

export function listParsers(): RepertoryParser[] {
  return Array.from(registry.values())
}

// ─── Built-in parsers ──────────────────────────────────────────────────────
registerParser(completeTabParser)
registerParser(jeremyQRepParser)
registerParser(murphyRtfParser)
