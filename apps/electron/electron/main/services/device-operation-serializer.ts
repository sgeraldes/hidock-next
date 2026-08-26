/**
 * Process-wide ordering for commands that consume the Jensen USB response
 * stream. Every caller shares this chain, including renderer IPC operations
 * and deferred device-file cleanup sweeps.
 *
 * A rejected operation is observed by its caller but never poisons the chain.
 */
let deviceOperationChain: Promise<unknown> = Promise.resolve()

export function serializeDeviceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = deviceOperationChain.then(operation, operation)
  deviceOperationChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
