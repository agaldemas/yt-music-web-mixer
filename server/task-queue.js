'use strict';

class TaskQueue {
  constructor(options) {
    const opts = options || {};
    this.concurrency = Math.max(1, Number(opts.concurrency) || 1);
    this.maxPending = Math.max(0, Number(opts.maxPending) || 0);
    this.active = 0;
    this.pending = [];
  }

  add(task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('TaskQueue.add: task invalide'));
    if (this.active + this.pending.length >= this.concurrency + this.maxPending) {
      const err = new Error('File de traitement pleine. Réessayez plus tard.');
      err.code = 'queue-full';
      err.retryAfter = 5;
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this._drain();
    });
  }

  stats() {
    return { active: this.active, pending: this.pending.length, concurrency: this.concurrency, maxPending: this.maxPending };
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        this.active -= 1;
        this._drain();
      });
    }
  }
}

module.exports = { TaskQueue };
