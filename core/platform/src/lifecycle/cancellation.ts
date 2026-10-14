/** Cancels the caller's wait; the operation and its acquired resources remain owned by the caller. */
export function waitWithCancellation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (accept: () => void): void => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', onAbort);
      accept();
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    // Observe the actual result even when the signal was already cancelled.
    void operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
