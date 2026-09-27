export class StartupAssetError extends Error {
  constructor(readonly assetLabel: string, cause: unknown) {
    super(`${assetLabel} could not be downloaded`, { cause });
    this.name = 'StartupAssetError';
  }
}

/** Three bounded attempts, with time for a transient connection failure to clear. */
export async function loadStartupAsset<T>(url: string, label: string, load: (url: string) => Promise<T>): Promise<T> {
  const delays = [0, 400, 1200];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    const requestUrl = attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}-${Date.now()}`;
    try { return await load(requestUrl); }
    catch (error) { if (attempt === delays.length - 1) throw new StartupAssetError(label, error); }
  }
  throw new Error('Startup attempt unavailable');
}
