import './styles/main.css';
import './styles/apprentice.css';
import './styles/site-pro.css';
import './styles/start-menu.css';
import './studio/webGameStudioAdapter';
import { Game } from './core/Game';
import './styles/worksite-theme.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root not found');

for (const eventName of ['selectstart', 'dragstart'] as const) {
  document.addEventListener(eventName, event => event.preventDefault());
}

const game = new Game(root);
// Complete this entry module before the lazy water chunk imports its shared
// Three.js exports. Top-level await creates a production-only import deadlock.
void game.ready.then(() => {
  window.__wireTheHouse = game;
  window.render_game_to_text = () => game.renderState();
  window.advanceTime = (ms: number) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let index = 0; index < steps; index += 1) game.step(1 / 60);
  };
}).catch(error => {
  console.error('Site preparation failed', error);
  const button = document.querySelector<HTMLButtonElement>('#start-button');
  const label = document.querySelector<HTMLElement>('#start-button-label');
  const progress = document.querySelector<HTMLOutputElement>('#start-load-percent');
  if (!button || !label || !progress) return;
  button.disabled = false;
  button.dataset.preparing = 'false';
  label.textContent = 'RETRY LOADING';
  progress.value = 'LOAD FAILED';
  progress.setAttribute('aria-label', 'Loading failed. Tap to retry');
  button.addEventListener('click', event => {
    event.stopImmediatePropagation();
    location.reload();
  }, { capture: true, once: true });
});
