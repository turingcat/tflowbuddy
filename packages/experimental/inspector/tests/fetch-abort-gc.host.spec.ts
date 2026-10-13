/** Real HTTP cancellation with forced GC in an isolated Node process. */
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

it('keeps caller abort connected after the temporary Request is garbage-collected', async (test) => {
  const fixture = fileURLToPath(new URL('./fixtures/fetch-abort-gc.ts', import.meta.url))
  const child = execa(process.execPath, ['--expose-gc', fixture], {
    timeout: test.task.timeout,
    cancelSignal: test.signal,
    killSignal: 'SIGKILL',
    reject: false,
  })
  test.onTestFinished(async () => { await child })
  const result = await child
  expect(result.timedOut, result.stderr).toBe(false)
  expect(result.isCanceled, result.stderr).toBe(false)
  expect(result.signal, result.stderr).toBeUndefined()
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout).toBe('Caller cancellation and capture completed after Request collection')
})
