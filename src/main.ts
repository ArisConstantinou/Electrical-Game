import './styles/main.css';
import './studio/webGameStudioAdapter';
import { Game } from './core/Game';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root not found');

const game = new Game(root);
window.__wireTheHouse = game;
window.render_game_to_text = () => game.renderState();
window.advanceTime = (ms: number) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let index = 0; index < steps; index += 1) game.step(1 / 60);
};
