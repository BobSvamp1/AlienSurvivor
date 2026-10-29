# Alien Survivor

Co-op first-person trap defense in the browser (1–4 players). You are a stranded crew on an alien moon: build traps in the corridors by day, survive the swarm at night.

- **Missions:** survive all waves (the last one is a double boss wave) and earn up to 3 stars. **Endless** mode never stops.
- **Traps:** Spikes, Goo, Flame Vents (Goo + fire = IGNITE combo), Launch Pads (throw aliens into chasms), Laser Fences on the walls, plus turrets and barricades.
- **Classes:** Marine (Pulse Rifle), Engineer (Scattergun), Pyro (Flamethrower) and Ranger (Rail Cannon), each with its own traps, defenses and perk.
- **Jetpack:** hold Space in the air to hover.

**Play:** https://bobsvamp1.github.io/aliensurvivor/

## Co-op
Main menu → **CO-OP**. One player presses **HOST** and gets a 5-letter room code; friends press **JOIN** and type the code. The host picks the mission and presses **DEPLOY**. Players connect directly to each other (WebRTC via PeerJS).

## Run locally
```
npm install
npm run dev
```
Then open http://localhost:5173

## Credits
- Textures: [Poly Haven](https://polyhaven.com) (CC0)
- Magazine sound: freesound_community via Pixabay
- Built with [three.js](https://threejs.org) and Vite
