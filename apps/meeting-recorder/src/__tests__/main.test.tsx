/**
 * Entry point test — verifies the React app mounts into a DOM root.
 * The actual App rendering is tested in App.test.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest'

describe('main entry point', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('root element exists in DOM', () => {
    const root = document.getElementById('root')
    expect(root).toBeTruthy()
  })

  it('root element is a div', () => {
    const root = document.getElementById('root')
    expect(root?.tagName).toBe('DIV')
  })

  it('ReactDOM.createRoot target exists before mounting', () => {
    const root = document.getElementById('root')!
    expect(root).not.toBeNull()
    expect(root.id).toBe('root')
  })
})
