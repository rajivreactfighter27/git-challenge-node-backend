class CircuitBreaker {
  constructor({
    failureThreshold = 3,
    windowMs = 30000,
    openDurationMs = 5000,
    maxHalfOpenRequests = 1,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.openDurationMs = openDurationMs;
    this.maxHalfOpenRequests = maxHalfOpenRequests;
    this.failureTimestamps = [];
    this.state = 'closed';
    this.nextAttemptAt = 0;
    this.halfOpenAttempts = 0;
  }

  pruneFailures(now = Date.now()) {
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp <= this.windowMs,
    );
  }

  onSuccess() {
    this.failureTimestamps = [];
    this.state = 'closed';
    this.nextAttemptAt = 0;
    this.halfOpenAttempts = 0;
  }

  onFailure() {
    const now = Date.now();
    this.pruneFailures(now);
    this.failureTimestamps.push(now);

    if (this.state === 'half-open') {
      this.state = 'open';
      this.nextAttemptAt = now + this.openDurationMs;
      this.halfOpenAttempts = 0;
      return;
    }

    if (this.failureTimestamps.length >= this.failureThreshold) {
      this.state = 'open';
      this.nextAttemptAt = now + this.openDurationMs;
    }
  }

  canAttempt() {
    const now = Date.now();

    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      if (now >= this.nextAttemptAt) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }

    if (this.halfOpenAttempts >= this.maxHalfOpenRequests) {
      this.state = 'open';
      this.nextAttemptAt = now + this.openDurationMs;
      return false;
    }

    this.halfOpenAttempts += 1;
    return true;
  }

  getRetryAfterSeconds() {
    if (this.state !== 'open') {
      return 0;
    }

    const remainingMs = Math.max(this.nextAttemptAt - Date.now(), 0);
    return Math.ceil(remainingMs / 1000);
  }
}

module.exports = { CircuitBreaker };
