/**
 * Tests for WaveformCanvas — verifies the per-speaker bar coloring, legend
 * isolation dimming, and click-to-seek. The 2D context is faked so we can
 * inspect the exact fill colors / alphas the component paints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { WaveformCanvas, type WaveformSpeakerRange } from '../WaveformCanvas'

interface Fill { color: string; alpha: number }

function fakeContext(fills: Fill[]) {
  const ctx: any = {
    _fillStyle: '#000',
    globalAlpha: 1,
    set fillStyle(v: string) { this._fillStyle = v },
    get fillStyle() { return this._fillStyle },
    clearRect: vi.fn(),
    fillRect: vi.fn(function (this: any) { fills.push({ color: this._fillStyle, alpha: this.globalAlpha }) }),
    strokeStyle: '#000',
    lineWidth: 1,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  }
  return ctx
}

const AUDIO = new Float32Array(400).fill(0.5)
const RANGES: WaveformSpeakerRange[] = [
  { startTime: 0, endTime: 5, color: '#2563EB', speakerKey: 'A' },
  { startTime: 5, endTime: 10, color: '#059669', speakerKey: 'B' },
]

let fills: Fill[]
let getContextSpy: ReturnType<typeof vi.spyOn>
let rectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fills = []
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(fakeContext(fills) as unknown as CanvasRenderingContext2D)
  rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ left: 0, top: 0, width: 800, height: 56, right: 800, bottom: 56, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  getContextSpy.mockRestore()
  rectSpy.mockRestore()
})

describe('WaveformCanvas speaker coloring', () => {
  it('paints bars with each speaker range color', () => {
    render(<WaveformCanvas audioData={AUDIO} duration={10} onSeek={vi.fn()} speakerRanges={RANGES} />)
    const colors = new Set(fills.map((f) => f.color))
    expect(colors.has('#2563EB')).toBe(true) // speaker A (first half)
    expect(colors.has('#059669')).toBe(true) // speaker B (second half)
  })

  it('dims every bar except the isolated speaker', () => {
    render(
      <WaveformCanvas audioData={AUDIO} duration={10} onSeek={vi.fn()} speakerRanges={RANGES} isolatedSpeakerKey="A" />
    )
    // Isolated speaker A bars render at full alpha; speaker B bars are faded.
    const aFull = fills.some((f) => f.color === '#2563EB' && f.alpha === 1)
    const bDim = fills.some((f) => f.color === '#059669' && f.alpha < 0.2)
    expect(aFull).toBe(true)
    expect(bDim).toBe(true)
  })

  it('seeks to the clicked position', () => {
    const onSeek = vi.fn()
    const { container } = render(
      <WaveformCanvas audioData={AUDIO} duration={10} onSeek={onSeek} speakerRanges={RANGES} />
    )
    const canvas = container.querySelector('canvas')!
    // Click at x=400 of an 800px canvas → halfway → 5s of a 10s clip.
    fireEvent.click(canvas, { clientX: 400 })
    expect(onSeek).toHaveBeenCalledWith(5)
  })
})
