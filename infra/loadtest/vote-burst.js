// k6-belastingstest — 120+ deelnemers met gelijktijdige stembursts (Gemini, voorstel §4.3).
// Doel: 95e percentiel responstijd < 1 s, stembevestiging < 2 s (v0.1.0 §12).
// Draai: docker compose --profile loadtest run --rm alv-loadtest
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = __ENV.TARGET || 'https://alv-proxy';

export const options = {
  scenarios: {
    // 120 deelnemers openen de pagina en pollen (wachtstand -> ronde open).
    steady_poll: {
      executor: 'constant-vus',
      vus: 120,
      duration: '1m',
      exec: 'poll',
    },
    // Stemburst: iedereen stemt binnen enkele seconden na ronde-open.
    vote_burst: {
      executor: 'per-vu-iterations',
      vus: 120,
      iterations: 1,
      startTime: '20s',
      exec: 'vote',
    },
  },
  thresholds: {
    'http_req_duration{name:status}': ['p(95)<1000'],
    'http_req_duration{name:vote}': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export function poll() {
  const res = http.get(`${TARGET}/deelnemen/api/status`, { tags: { name: 'status' } });
  check(res, { 'status 200/401': (r) => r.status === 200 || r.status === 401 });
  // Jitter 3-6 s zoals het ontwerp (v0.1.0 §6): niet alle telefoons tegelijk.
  sleep(3 + Math.random() * 3);
}

export function vote() {
  const payload = JSON.stringify({ choice: 'voor' });
  const res = http.post(`${TARGET}/deelnemen/api/vote`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'vote' },
  });
  check(res, { 'vote afgehandeld': (r) => r.status < 500 });
}
