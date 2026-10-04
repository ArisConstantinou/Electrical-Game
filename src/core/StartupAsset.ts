export class StartupAssetError extends Error {
  constructor(readonly assetLabel: string, cause: unknown) {
    super(`${assetLabel} could not be downloaded`, { cause });
    this.name = 'StartupAssetError';
  }
}

/** Shared failure presentation for initial loading and later crew preparation. */
export function showStartupFailure(error: unknown): void {
  console.error('Site preparation failed', error);
  const button = document.querySelector<HTMLButtonElement>('#start-button');
  const label = document.querySelector<HTMLElement>('#start-button-label');
  const progress = document.querySelector<HTMLOutputElement>('#start-load-percent');
  if (!button || !label || !progress) return;
  button.disabled = false;
  button.dataset.preparing = 'false';
  button.dataset.failed = 'true';
  button.setAttribute('aria-label', 'Retry loading');
  label.textContent = 'RETRY LOADING';
  progress.value = 'LOAD FAILED';
  progress.setAttribute('aria-label', 'Loading failed. Tap to retry');
  const detail = document.querySelector<HTMLElement>('#start-load-error');
  if (detail) {
    detail.hidden = false;
    detail.textContent = error instanceof StartupAssetError
      ? `${error.assetLabel} could not load. Check your connection and tap Retry loading.`
      : 'Site preparation failed. Tap Retry loading to try again.';
  }
  button.addEventListener('click', event => {
    event.stopImmediatePropagation();
    location.reload();
  }, { capture: true, once: true });
}

/** Three attempts; cancellable deadlines are opt-in for loaders that own cleanup. */
export async function loadStartupAsset<T>(url: string, label: string,
  load: (url: string, signal: AbortSignal) => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  const delays = [0, 400, 1200];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    const requestUrl = attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}-${Date.now()}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = load(requestUrl, controller.signal);
      if (!options.timeoutMs) return await pending;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} did not finish within ${options.timeoutMs} ms`);
          controller.abort(error);
          reject(error);
        }, options.timeoutMs);
      });
      return await Promise.race([pending, deadline]);
    }
    catch (error) { if (attempt === delays.length - 1) throw new StartupAssetError(label, error); }
    finally { clearTimeout(timer); }
  }
  throw new Error('Startup attempt unavailable');
}
