import './ui/hud.css';
import { GameEngine } from './game/GameEngine';
import { gameStore, loadSave, startAutoSave } from './state/gameStore';
import { setupInstall } from './ui/install';

const app = document.getElementById('app')!;
const loading = document.getElementById('loading');

loadSave();
startAutoSave();
setupInstall();

GameEngine.create(app)
  .then((game) => {
    game.start();
    // Dev-only handle for poking at the game from the browser console.
    if (import.meta.env.DEV) Object.assign(window, { game, store: gameStore });
    loading?.remove();
  })
  .catch((err: unknown) => {
    console.error(err);
    if (loading) loading.textContent = 'The lab failed to boot. Check the console for details.';
  });
