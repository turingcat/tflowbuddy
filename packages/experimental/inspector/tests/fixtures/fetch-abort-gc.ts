/** Native fetch cancellation after the observer's temporary Request is collected. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setImmediate } from 'node:timers/promises'
import { installFetchObserver, type FetchObserver } from '../../src/host/inspection/network.ts'
import { requireJsonObject, type InspectorJsonValue } from '../../src/shared/json.ts'

const collect = globalThis.gc
assert.ok(collect, 'Run this fixture with --expose-gc')
const nativeFetch = globalThis.fetch
let normalizedRequest: WeakRef<Request> | undefined
globalThis.fetch = (input, init) => {
  assert.ok(input instanceof Request)
  normalizedRequest = new WeakRef(input)
  return nativeFetch(input, init)
}

const firstCaptured = Promise.withResolvers<true>()
const captureFinished = Promise.withResolvers<InspectorJsonValue>()
const firstChunk = 'data: first\n\ndata: [DONE]\n\n'
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(firstChunk)
})
let observer: FetchObserver | undefined
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  observer = installFetchObserver({
    publish(topic, payload) {
      if (topic === 'fetch/response-body-chunk') firstCaptured.resolve(true)
      if (topic === 'fetch/end') captureFinished.resolve(payload)
    },
  }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 1_024 })
  const abort = new AbortController()
  const response = await fetch(`http://127.0.0.1:${String(address.port)}/events`, { signal: abort.signal })
  assert.ok(response.body)
  reader = response.body.getReader()
  assert.equal(Buffer.from((await reader.read()).value ?? []).toString(), firstChunk)
  await firstCaptured.promise

  // Weak references remain live until the next job; collect only after yielding.
  await setImmediate()
  collect()
  await setImmediate()
  collect()
  assert.equal(normalizedRequest?.deref(), undefined, 'The temporary Request must be collected before abort')

  abort.abort()
  try { await reader.cancel() } catch (error) {
    assert.ok(error instanceof DOMException && error.name === 'AbortError')
  }
  const outcome = requireJsonObject(await captureFinished.promise, 'Captured response')
  assert.equal(outcome.capturedBytes, Buffer.byteLength(firstChunk))
  assert.equal(outcome.responseBodyTruncated, true)
  assert.ok(typeof outcome.responseCaptureError === 'string')
  assert.match(outcome.responseCaptureError, /AbortError/u)
  console.log('Caller cancellation and capture completed after Request collection')
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  await observer?.stop()
  reader?.releaseLock()
  globalThis.fetch = nativeFetch
}
