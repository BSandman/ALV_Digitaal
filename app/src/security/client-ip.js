import { isIP } from 'node:net';

/**
 * Geeft uitsluitend de door de gecontroleerde proxy aangeleverde client-IP terug.
 * Caddy overschrijft X-Forwarded-For met remote_host; meerdere hops zijn daarom fout.
 */
export function getVerifiedClientIp(request, { trustProxy = false } = {}) {
  const direct = normalizeIp(request.socket?.remoteAddress);
  if (!trustProxy) return requireIp(direct);

  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded !== 'string' || forwarded.includes(',')) {
    const error = new Error('unverified_client_ip');
    error.code = 'UNVERIFIED_CLIENT_IP';
    throw error;
  }
  return requireIp(normalizeIp(forwarded.trim()));
}

function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function requireIp(value) {
  if (!isIP(value)) {
    const error = new Error('unverified_client_ip');
    error.code = 'UNVERIFIED_CLIENT_IP';
    throw error;
  }
  return value;
}
