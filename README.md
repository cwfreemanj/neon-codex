# Neon Codex: Multiplayer Edition

A 12-player browser arena game built with HTML5 Canvas, Node.js, Express, and Socket.IO.

## Features

- Up to 12 players per room
- Room codes, quick join, host-started matches
- Main menu character customization
- 8 gameplay classes
- 20 pixel-neon skin silhouettes inspired by the provided boss grid style
- Primary and trim palette selection
- Mobile joystick/buttons plus desktop controls
- Game modes:
  - Co-op Boss Rush
  - King/Queen of the Hill
  - Versus: Free-for-All
  - Versus: Crystal Clash

## Local setup

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Open the same address in multiple browser tabs, or from other devices on the same network using your computer's local IP.

## Railway deployment

1. Create a new GitHub repository.
2. Upload these files:
   - `server.js`
   - `package.json`
   - `public/index.html`
3. On Railway, create a new project from the GitHub repository.
4. Railway should detect the Node app automatically.
5. Start command should be:

```bash
npm start
```

6. After deployment, open the Railway public URL. Players anywhere can join with the room code.

## Controls

Desktop:

- WASD / Arrow Keys: Move
- Mouse: Aim
- Click / Space: Shoot
- Shift / E: Dash
- Q: Skill
- Esc: Toggle menu overlay

Mobile:

- Left joystick: Move
- Shoot, Dash, Skill buttons on the right
- Landscape orientation recommended

## Notes

This version uses a server-authoritative game loop for player movement, bullets, enemies, score, objective capture, and match state. Client rendering is canvas-only and uses procedural pixel silhouettes, so no image assets are required.
