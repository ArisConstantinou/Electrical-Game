import type { Game } from './core/Game';

declare global {
  interface Window {
    __wireTheHouse?: Game;
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
  }
}

export {};
