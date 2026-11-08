import { PlayerHub } from './PlayerHub';
import { createTransport } from './Transport';

/** Єдиний екземпляр мережі на весь застосунок екрана */
export const hub = new PlayerHub(createTransport());
