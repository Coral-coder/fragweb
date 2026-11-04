# FragWeb Arena

A fast arena deathmatch you play in a web browser, made for LAN parties. Nobody installs anything. It's an original game: its own map, weapons, characters and sounds.

## How it works on GitHub Pages

GitHub Pages can only host static files, so there's no game server:

- **One player clicks "Host game".** Their browser tab runs the match in a background Web Worker, so it keeps going even if they alt-tab, and they show a 5-letter **room code**.
- **Everyone else opens the same page**, picks "Join a game" and enters the code. They can also open `…/?room=CODE` directly.
- The browsers connect **peer-to-peer over WebRTC**. The free [PeerJS](https://peerjs.com) broker is used only to introduce them. After that, game traffic goes directly between the PCs on your LAN.
- There's also **Practice offline**, which is you against bots with no network at all.

Requirements: a modern Chrome, Edge or Firefox, and internet access (to load the page and libraries and to find each other). Keep the host's tab open for the whole match.

## Turning on GitHub Pages

1. Merge this branch into `main`.
2. In the repo, open **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, then Save.
4. After a minute the game is at `https://<your-username>.github.io/fragweb/`.

## Controls

| Action | Key |
| --- | --- |
| Move / jump | WASD / Space |
| Fire | Left mouse |
| Weapons | 1–5, mouse wheel, Q/E |
| Scoreboard | Tab |
| Chat | T |
| Menu (graphics quality, sensitivity, FOV, volume, add/remove bots) | Esc |

Rocket-jump by looking down, jumping and firing at your feet.

## Weapons

1. **Sidearm**: infinite ammo, accurate.
2. **Scattergun**: 10-pellet blast, brutal up close.
3. **Pulse Rifle**: rapid-fire hitscan.
4. **Rocket Launcher**: splash damage and knockback.
5. **Rail Lance**: 90-damage instant beam.

Pickups: health (+25), mega health (+100, up to 200), armor (+50), armor shards (+5) and ammo.

## Performance

Press **Esc** and pick a **Graphics quality**:

- **High** adds glow effects (bloom) and sharp shadows.
- **Medium** keeps shadows but turns off glow.
- **Low** is for older PCs and laptops.

The current frame rate is shown in the top-left corner.

## Running locally

Any static file server works, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Code layout

- `index.html`, `css/style.css`: menus and HUD
- `js/game.js`: shared rules, map, physics and raycasts
- `js/host.js`: authoritative match simulation (damage, pickups, rockets, bots, scoring)
- `js/host-worker.js`: runs the simulation in a Web Worker
- `js/net.js`: PeerJS/WebRTC hosting and joining
- `js/gfx.js`: procedural textures, arena geometry, sky, player and weapon models, particles and decals
- `js/client.js`: input, movement prediction, camera and weapon animation, HUD and synthesized audio
