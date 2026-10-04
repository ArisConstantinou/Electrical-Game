import './styles/main.css';
import './styles/apprentice.css';
import './styles/site-pro.css';
import './styles/start-menu.css';
import './studio/webGameStudioAdapter';
import { Game } from './core/Game';
import './styles/worksite-theme.css';
import { showStartupFailure } from './core/StartupAsset';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root not found');

if (new URLSearchParams(location.search).get('performance') === '1') {
  void import('./ui/PerformanceTest').then(module => module.openPerformanceTest(root));
} else {
  startGame(root);
}

function startGame(root: HTMLElement): void {
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
  }).catch(showStartupFailure);
  document.querySelector('#start-performance-test')?.addEventListener('click', () => {
    const url = new URL(import.meta.env.BASE_URL, location.origin);
    for (const key of ['renderer', 'v']) {
      const value = new URLSearchParams(location.search).get(key);
      if (value) url.searchParams.set(key, value);
    }
    url.searchParams.set('performance', '1');
    location.assign(url.href);
  });
}
