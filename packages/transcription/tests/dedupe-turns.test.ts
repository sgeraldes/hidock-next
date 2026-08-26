import { describe, it, expect } from 'vitest'
import { TurnDeduper, dedupeTurns, normalizeTurnText } from '../src/engines/dedupe-turns.js'
import type { TranscriptSegment } from '../src/engines/engine-interface.js'

function turn(text: string, startTime: number, speaker = 'Speaker 1'): TranscriptSegment {
  return { speaker, text, startTime, endTime: startTime, confidence: 1, source: 'mic' }
}

/** A substantive block of turns, as produced for one ~10 minute chunk. */
function block(offset: number): TranscriptSegment[] {
  return [
    turn('crecimos de manera remota, es decir, los primeros contratos de gente fueron todos remotos', offset),
    turn('que conserva hoy, no es presencial cien por ciento, sino que conserva el modelo hibrido', offset + 46),
    turn('Eh', offset + 79),
    turn('no hay problema por este hecho de que no tengo una oficina asignada en la ciudad', offset + 81),
    turn('en tu caso una catedra, tenemos varias personas que tienen ese mismo arreglo', offset + 89),
  ]
}

describe('normalizeTurnText', () => {
  it('collapses case and whitespace', () => {
    expect(normalizeTurnText('  Hola   MUNDO \n')).toBe('hola mundo')
  })
})

describe('TurnDeduper — cross-chunk block replay', () => {
  it('drops a whole block replayed at the next chunk offset (the Rec08 failure)', () => {
    const deduper = new TurnDeduper()

    // Chunk 3 — genuine content.
    const first = deduper.push(block(1800))
    expect(first).toHaveLength(5)

    // Chunk 4 — model replays chunk 3 verbatim at the new offset, then continues.
    const replayed = [...block(2402), turn('Entonces de esa misma manera muchos clientes utilizan el modelo', 2600)]
    const second = deduper.push(replayed)

    expect(second.map((t) => t.text)).toEqual([
      'Entonces de esa misma manera muchos clientes utilizan el modelo'
    ])
    expect(deduper.dropped).toBe(5)
  })

  it('drops the same block replayed again three chunks later (+1800s)', () => {
    const deduper = new TurnDeduper()
    deduper.push(block(1800))
    deduper.push(block(2402))
    const third = deduper.push(block(3602))
    expect(third).toHaveLength(0)
    expect(deduper.dropped).toBe(10)
  })
})

describe('TurnDeduper — must not eat real speech', () => {
  it('keeps repeated backchannel utterances', () => {
    const deduper = new TurnDeduper()
    const kept = deduper.push([
      turn('Si.', 10), turn('Okay.', 12), turn('Si.', 20),
      turn('Eh', 25), turn('Okay.', 30), turn('Si.', 44)
    ])
    expect(kept).toHaveLength(6)
    expect(deduper.dropped).toBe(0)
  })

  it('keeps a single long sentence repeated for emphasis', () => {
    const deduper = new TurnDeduper()
    const line = 'el cliente siempre define las prioridades del sprint y nosotros ejecutamos'
    const kept = deduper.push([turn(line, 5), turn('Claro.', 20), turn(line, 30)])
    expect(kept).toHaveLength(3)
  })

  it('keeps a repeated short run with no substantive turn', () => {
    const deduper = new TurnDeduper()
    const kept = deduper.push([
      turn('Si.', 1), turn('Claro.', 2),
      turn('Bueno.', 3),
      turn('Si.', 10), turn('Claro.', 11)
    ])
    expect(kept).toHaveLength(5)
  })
})

describe('TurnDeduper — degenerate tail loop', () => {
  it('collapses a substantive turn repeating forever at the tail', () => {
    const deduper = new TurnDeduper()
    const line = 'y he tenido casos en los que el cliente delega completamente la priorizacion'
    const looping = Array.from({ length: 40 }, (_, i) => turn(line, 4000 + i))
    const kept = deduper.push([turn('Del lado del cliente siempre, me estas diciendo.', 3990), ...looping])
    // The opener plus a bounded number of repeats survive; the loop does not.
    expect(kept.length).toBeLessThanOrEqual(1 + 2)
    expect(kept[0].text).toBe('Del lado del cliente siempre, me estas diciendo.')
  })
})

describe('dedupeTurns', () => {
  it('is a one-shot wrapper preserving order of survivors', () => {
    const out = dedupeTurns([...block(0), ...block(600)])
    expect(out.map((t) => t.startTime)).toEqual([0, 46, 79, 81, 89])
  })

  it('returns an empty array unchanged', () => {
    expect(dedupeTurns([])).toEqual([])
  })
})
