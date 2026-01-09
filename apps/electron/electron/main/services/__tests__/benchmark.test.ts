
import { describe, it } from 'vitest'
import { getHiDockDeviceService } from '../../../../src/services/hidock-device'
import { getJensenDevice } from '../../../../src/services/jensen'

describe('HiDock Initialization Benchmark', () => {
  it('measures sequential vs attempted parallel performance', async () => {
    const service = getHiDockDeviceService()
    const jensen = getJensenDevice()

    if (!jensen.isConnected()) {
      console.log('SKIPPING BENCHMARK: No device connected')
      return
    }

    console.log('--- STARTING SEQUENTIAL BENCHMARK ---')
    const seqStart = performance.now()
    await service.refreshDeviceInfo()
    const t1 = performance.now()
    await service.refreshStorageInfo()
    const t2 = performance.now()
    await service.refreshSettings()
    const t3 = performance.now()
    await service.syncTime()
    const seqEnd = performance.now()

    console.log(`Sequential Stats:`)
    console.log(`- Device Info: ${(t1 - seqStart).toFixed(2)}ms`)
    console.log(`- Storage Info: ${(t2 - t1).toFixed(2)}ms`)
    console.log(`- Settings: ${(t3 - t2).toFixed(2)}ms`)
    console.log(`- Time Sync: ${(seqEnd - t3).toFixed(2)}ms`)
    console.log(`- TOTAL SEQ: ${(seqEnd - seqStart).toFixed(2)}ms`)

    console.log('--- STARTING PARALLEL BENCHMARK (Simulated) ---')
    const parStart = performance.now()
    // Fire all at once. Jensen's withLock will queue them, 
    // but we measure if the overhead changes.
    await Promise.all([
      service.refreshDeviceInfo(),
      service.refreshStorageInfo(),
      service.refreshSettings(),
      service.syncTime()
    ])
    const parEnd = performance.now()
    console.log(`Parallel Total: ${(parEnd - parStart).toFixed(2)}ms`)
    console.log(`Improvement: ${(((seqEnd - seqStart) - (parEnd - parStart)) / (seqEnd - seqStart) * 100).toFixed(2)}%`)
  })

  it('profiles List Files packet latency', async () => {
    const service = getHiDockDeviceService()
    const jensen = getJensenDevice()

    if (!jensen.isConnected()) return

    console.log('--- PROFILING LIST FILES ---')
    const start = performance.now()
    let packetCount = 0
    let lastPacketTime = start

    const files = await service.listRecordings((found, total) => {
      const now = performance.now()
      packetCount++
      console.log(`Packet ${packetCount}: ${found}/${total} files (Delta: ${(now - lastPacketTime).toFixed(2)}ms)`)
      lastPacketTime = now
    }, true) // forceRefresh

    const end = performance.now()
    console.log(`List Files Summary:`)
    console.log(`- Total Files: ${files.length}`)
    console.log(`- Total Time: ${(end - start).toFixed(2)}ms`)
    console.log(`- Avg Packet Latency: ${((end - start) / packetCount).toFixed(2)}ms`)
  })
})
