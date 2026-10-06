# Afterhours — Insider

The default mode is online multiplayer: every player joins the same room from their own phone. Pass & Play remains available from the top navigation.

## Local development

Use Node.js 24 or newer. In two terminals, from the project root:

```sh
npm install
npm --prefix server install
cp .env.example .env
cp server/.env.example server/.env
npm run dev:server
```

Then run `npm run dev` in the other terminal and open the Vite URL. The development server proxies Socket.IO to `127.0.0.1:3001`.

## Build and run with PM2

Build the browser app and install the server dependencies:

Use Node.js 24 or newer on the build and deployment host (`node --version` should report `v24` or later). The `server` deploy command selects Node 24 through NVM before it invokes the remote deployment script.

```sh
npm ci
npm ci --prefix server
npm run build
cp server/.env.example server/.env
```

Set `CLIENT_ORIGIN` in `server/.env` to the origin (scheme and hostname) where players open the game. For example, use `https://games.example.com`; multiple origins can be separated by commas. Cloudflare Pages previews can be allowed with a one-level HTTPS wildcard such as `https://*.insider-69n.pages.dev`. PM2 runs from `server/` so the server loads this `server/.env` file. The Node server serves the built `dist/` app and the Socket.IO endpoint from the same port, so a reverse proxy can forward HTTP and WebSocket traffic to port `3001`.

Start the single server process with PM2 from the project root:

```sh
pm2 startOrReload server/ecosystem.config.cjs --update-env
pm2 save
```

To deploy the current GitHub revision to OCI, run `npm run deploy --prefix server` from the project root. This runs the remote deployment script, installs dependencies, builds both the frontend and server, then reloads and saves the PM2 process. Ensure the revision has been pushed before deploying.

For a separately hosted frontend, set `VITE_SOCKET_URL` at build time to the public Node server URL and allow the frontend origin in `CLIENT_ORIGIN`. The Pages wildcard allows `https://<deployment>.insider-69n.pages.dev` without allowing other Pages projects or nested subdomains. Add it alongside the production frontend origin, comma-separated, then reload the server with updated environment variables.

## Room and privacy notes

- Room codes are six characters. Rooms support 4–12 players and are held in server memory.
- The room creator is the Judge. The server selects one other player as the Insider and privately sends the word only to those two devices. Citizens receive their role without the word.
- Wrong guesses, private roles, and ballot selections are never broadcast to other players. The word and roles are revealed to the room only when the round ends.
- Players can refresh or reconnect on the same device and rejoin their saved room. Joining a room again with the same username resumes that player identity, including the host identity. Rooms are removed after 24 hours of inactivity.
- A process restart clears active rooms. Run one PM2 instance in fork mode; this in-memory room store is not intended for PM2 cluster mode or multiple server replicas.
