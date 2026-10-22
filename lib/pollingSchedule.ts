export const MIN_POLL_INTERVAL_MS = 5_000;
export const MAX_POLL_INTERVAL_MS = 60_000;

export type PollingState = {
  intervalMs: number;
  consecutiveFailures: number;
};

export const initialPollingState: PollingState = {
  intervalMs: MIN_POLL_INTERVAL_MS,
  consecutiveFailures: 0,
};

/**
 * Compute the next polling state after a load attempt.
 *
 * - On success, reset the interval to the minimum and clear the failure count.
 * - On failure, double the interval (backing off) up to the maximum.
 */
export function nextPollingState(
  state: PollingState,
  succeeded: boolean,
): PollingState {
  if (succeeded) {
    return {
      intervalMs: MIN_POLL_INTERVAL_MS,
      consecutiveFailures: 0,
    };
  }

  return {
    intervalMs: Math.min(state.intervalMs * 2, MAX_POLL_INTERVAL_MS),
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

/**
 * Whether polling should run given the current document visibility.
 * Defaults to polling when visibility is unknown (e.g. SSR).
 */
export function shouldPoll(visibilityState: string | undefined): boolean {
  return visibilityState !== "hidden";
}
