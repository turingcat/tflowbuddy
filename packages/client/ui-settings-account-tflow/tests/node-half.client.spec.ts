/** Node half: the Loader must activate it before the browser half reaches the desktop roster. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as nodeHalf from '../src/index.ts'

it('loads as a host plugin so the account launcher and settings pages ship', () => {
  // A node half that is not a plugin fails to import in the Loader, and the
  // browser roster then omits every contribution, leaving the default Settings trigger.
  expect(() => new Context().plugin(nodeHalf)).not.toThrow()
})
