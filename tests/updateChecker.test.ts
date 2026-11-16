import test from 'node:test'
import assert from 'node:assert/strict'
import { compareSemver } from '../src/main/updateChecker'

test('compareSemver compares versions with and without v prefix', () => {
  assert.equal(compareSemver('0.1.3', '0.1.4'), -1)
  assert.equal(compareSemver('v0.1.3', 'v0.1.3'), 0)
  assert.equal(compareSemver('0.2.0', '0.1.9'), 1)
  assert.equal(compareSemver('0.1.3', '1.0.0'), -1)
  assert.equal(compareSemver('0.1.3-beta.1', '0.1.3'), 0)
})
