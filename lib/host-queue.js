'use strict'

/**
 * Per-host FIFO queue with concurrency cap and optional minimum spacing between starts.
 */

class HostQueue {
  constructor () {
    /** @type {Map<string, { running: number, waiters: Function[], lastStart: number, policy: object }>} */
    this._hosts = new Map()
  }

  _bucket (hostname, policy) {
    const key = hostname || '__default__'
    if (!this._hosts.has(key)) {
      this._hosts.set(key, {
        running: 0,
        waiters: [],
        lastStart: 0,
        policy: policy || { concurrency: 4, minIntervalMs: 0 },
      })
    }
    const b = this._hosts.get(key)
    if (policy) b.policy = policy
    return b
  }

  async run (hostname, policy, fn) {
    const b = this._bucket(hostname, policy)
    await this._acquire(b)
    try {
      return await fn()
    } finally {
      this._release(b)
    }
  }

  _acquire (b) {
    return new Promise((resolve) => {
      const tryStart = () => {
        const max = Math.max(1, b.policy.concurrency || 1)
        if (b.running >= max) {
          b.waiters.push(tryStart)
          return
        }
        const spacing = b.policy.minIntervalMs || 0
        const now = Date.now()
        const waitMs = spacing > 0 ? Math.max(0, spacing - (now - b.lastStart)) : 0
        if (waitMs > 0) {
          setTimeout(() => {
            b.running += 1
            b.lastStart = Date.now()
            resolve()
          }, waitMs)
        } else {
          b.running += 1
          b.lastStart = now
          resolve()
        }
      }
      tryStart()
    })
  }

  _release (b) {
    b.running = Math.max(0, b.running - 1)
    const next = b.waiters.shift()
    if (next) next()
  }
}

module.exports = { HostQueue }
