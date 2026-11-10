# FragWeb Arena

A fast arena shooter you play in a web browser, made for LAN parties. Nobody installs anything. One player hosts a match from their browser, and everyone else joins with a room code.

Play at **https://coral-coder.github.io/fragweb/**

FragWeb is an original game. All maps, weapons, characters, effects and sounds were made for this project. The surface textures are CC0 (public domain) photo scans from Poly Haven.

## Features

- **4 maps**, from a tight duel yard to a 200-metre Capture the Flag canyon:
  - **Crucible Yard** (small): walled yard with towers, ledges and a central dais.
  - **Foundry Nine** (large): a smelting hall over a lava pit, with balconies, container yards and rooftop sniping.
  - **Twin Spires** (huge, CTF): two fortresses across a bottomless canyon, with ramparts, sniper spires and three bridges.
  - **Skyreach** (medium): floating sandstone ruins over the clouds, with slightly lighter gravity and a long way down.
- **4 modes:** Deathmatch, Team Deathmatch, Capture the Flag and Duel, with overtime when scores are tied.
- **4 mutators:** Instagib, Low Gravity, Full Arsenal and Vampire.
- **8 weapons, each with an alt-fire:**

  | # | Weapon | Primary | Alt-fire |
  |---|---|---|---|
  | 1 | Sidearm | Accurate shot (headshots ×1.5) | 3-round burst |
  | 2 | Scattergun | 10-pellet blast | Lobbed breach grenade |
  | 3 | Pulse Rifle | Rapid hitscan | Plasma orb with splash |
  | 4 | Arc Caster | Lightning beam that chains to a 2nd enemy | Shockwave knockback blast |
  | 5 | Shard Cannon | Fan of ricocheting shards | Cluster bomb |
  | 6 | Rocket Launcher | Rocket (rocket-jumps!) | Hold to load up to 3, release a volley |
  | 7 | Rail Lance | 85-damage beam, lethal headshots | Hold to zoom |
  | 8 | Nova Charge | Super-weapon: huge slow orb, enormous blast | — |

- **Movement:** dodge (double-tap a direction or press Shift), double-jump, wall-dodge, jump pads and rocket jumps.
- **Pickups and power-ups:** health, health vials, Mega Health, armor, armor shards, **Damage Amplifier** (×2 damage), **Aegis Field** (+100 shield) and **Jump Boots**.
- **Bots** at four skill levels (Novice to Master). They find their way around every map using a navigation network generated from the map itself, pick weapons for the range, lead their shots, dodge, and play attack or defense in CTF.
- **Announcer and stats:** first blood, multi-frags, sprees, headshots and flag events, with an optional voice. The end-of-match screen shows accuracy, headshots, best spree, captures and awards.
- **Graphics:** CC0 photo-scanned textures, per-map skies (night, smoggy industrial, day with clouds), animated lava, waving flags, bloom, shadows, particles and decals. There are Low, Medium and High quality presets.

## How it works on GitHub Pages

GitHub Pages only serves static files, so there's no game server:

- The **host's browser runs the match** in a Web Worker, so it keeps ticking even if they alt-tab, and gets a 5-letter room code.
- Other players open the same page, choose **Join** and enter the code, or open `…/?room=CODE`.
- Browsers connect **peer-to-peer over WebRTC**. The free PeerJS broker only introduces them. After that, game traffic goes directly between the PCs on your LAN.
- **Practice offline** runs a match against bots with no network at all.

Requirements: a modern Chrome, Edge or Firefox and internet access to load the page and find each other. The host must keep their tab open for the whole session.

## Controls

| Action | Key |
| --- | --- |
| Move | WASD |
| Jump / double-jump | Space (press again in the air) |
| Dodge | Double-tap a direction, or Shift |
| Fire / alt-fire | Left / right mouse |
| Weapons | 1–8, mouse wheel, Q = last weapon |
| Scoreboard | Tab |
| Chat / team chat | T / Y |
| Menu (settings, switch team, add/remove bots, leave) | Esc |

## Deploying

Pushes to `main` (or this branch) deploy automatically through `.github/workflows/pages.yml`. In **Settings → Pages**, set the source to **GitHub Actions**.

To run it locally, use any static file server:

```bash
python3 -m http.server 8000
```

## Code layout

- `index.html`, `css/style.css`: menus and HUD
- `js/game.js`: shared rules, weapons, power-ups, movement (dodge and double-jump) physics and raycasts
- `js/maps.js`: the four map layouts and their visual themes
- `js/nav.js`: auto-generated navigation network and A* pathfinding for bots
- `js/bots.js`: bot AI (goals, CTF roles, combat, dodging, skill levels)
- `js/host.js`: authoritative match simulation (weapons, projectiles, damage, CTF, sprees, stats and awards)
- `js/host-worker.js`: runs the simulation in a Web Worker
- `js/net.js`: PeerJS/WebRTC hosting and joining
- `js/world.js`: builds each map's visuals (textures, sky, lava, pads, pickups and flags)
- `js/gfx.js`: weapon, player and pickup models, particles, beams and decals
- `js/audio.js`: synthesized sound effects and the speech announcer
- `js/client.js`: input, prediction, effects, HUD, menus and rendering
- `assets/textures/`: CC0 textures from [Poly Haven](https://polyhaven.com) (diffuse, normal and roughness)
