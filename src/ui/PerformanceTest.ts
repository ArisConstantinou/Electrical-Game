import template from './performance-test.html?raw';

/** Lazy menu mode: no parent game or second renderer while the test runs. */
export async function openPerformanceTest(root: HTMLElement): Promise<void> {
  document.title = 'Electrical-Game · Performance Test';
  document.documentElement.lang = 'el';
  root.innerHTML = template;
  const begin = root.querySelector<HTMLButtonElement>('#begin')!;
  const close = root.querySelector<HTMLButtonElement>('#close')!;
  begin.disabled = true;
  close.onclick = () => location.assign(import.meta.env.BASE_URL);
  const recorderUrl = `${import.meta.env.BASE_URL}performance/recorder.js`;
  try { await import(/* @vite-ignore */ recorderUrl); begin.disabled = false; }
  catch (error) {
    console.error('Performance test could not load', error);
    root.querySelector('#status')!.textContent = 'Performance test could not load. Return to the main menu and try again.';
    root.querySelector<HTMLButtonElement>('#begin')!.disabled = true;
    root.querySelector<HTMLButtonElement>('#close')!.onclick = () => location.assign(import.meta.env.BASE_URL);
  }
}
