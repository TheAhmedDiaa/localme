# LocalMe

Share files between devices on the same network. Files never touch a server: they stay in the
uploader's browser tab and stream **browser → browser** over WebRTC. The server only introduces
devices and keeps a tiny in-memory file list.

## Layout
- `shared/` – protocol types
- `worker/` – Cloudflare Worker + Durable Object (one per room). Also serves the built client.
- `client/` – React + TS + Vite

## Run
```bash
npm install
npm run dev          # worker on :8787, vite on :5173 (open the Vite URL; /ws is proxied)
```
Open the Vite URL on two devices/tabs. Devices behind the same public IP land in the same room
automatically; use the room button for a private code/QR room.

## Deploy
```bash
npx wrangler login
npm run deploy       # builds client, deploys worker + static assets
```

## Notes
- Password on a file is checked by the owner's browser over the P2P channel; it never reaches the server.
- "Download all" skips password-protected files (download those one by one).
- Disk streaming: Chrome/Edge use the File System Access API; Firefox/Safari use a service-worker
  stream (`client/public/sw.js`); last resort is an in-memory Blob (small files only).
- Strict networks (symmetric NAT / client isolation) may need a TURN server – add it to `ICE` in `client/src/lib/p2p.ts`.
