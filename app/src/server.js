// PLACEHOLDER — minimale single-process HTTP-server zodat de Docker-omgeving
// direct opstart en de healthcheck/loadtest iets krijgen om te raken.
// Codex vervangt dit in Fase 1-2 door de echte beheer-/eigenaar-routes.
// Architectuurregels: EEN proces, alle state in MySQL, servertijd (UTC) leidend.
import http from 'node:http';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Publieke healthcheck zonder persoonsgegevens (v0.1.0 §7).
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    return;
  }

  // Placeholder-statusendpoint voor de loadtest.
  if (url.pathname === '/deelnemen/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: 'v0' });
    res.end(JSON.stringify({ version: 0, round: 'waiting' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// EEN proces, geen cluster. Spiegelt shared hosting.
server.listen(PORT, () => {
  console.log(`[alv-app] placeholder luistert op :${PORT} (single process)`);
});
