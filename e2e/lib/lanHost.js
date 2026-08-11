/**
 * Resolves the host address the e2e stack is reached on.
 *
 * These specs deliberately do *not* use localhost. Browsers treat `localhost`,
 * `127.0.0.0/8` and `::1` as trustworthy origins, so a `Secure` cookie is
 * accepted over plain HTTP there. Every cookie-transport bug this suite exists
 * to catch is therefore invisible on loopback and only appears on the LAN
 * address a real user browses to — which is exactly how the password-change
 * logout in 1044d9c reached production.
 *
 * Override with E2E_HOST when the heuristic picks the wrong adapter.
 */
const os = require('os');

/*
 * Adapters that exist on a developer machine but are not the address a phone or
 * laptop on the same network would reach this host at. WSL and the Docker/Hyper-V
 * switches are the common Windows offenders.
 */
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|docker|virtualbox|vmware|loopback|bluetooth|tailscale|zerotier/i;

/** Private IPv4 ranges, most-preferred first. */
const PRIVATE_RANGES = [
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
];

function candidates() {
  const found = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push({ name, address: address.address });
    }
  }

  return found;
}

/**
 * Picks the most plausible LAN address: a physical adapter on a private range,
 * preferring 192.168/16 over the ranges that virtual switches tend to squat on.
 */
function resolveLanHost() {
  if (process.env.E2E_HOST) return process.env.E2E_HOST;

  const found = candidates();
  const physical = found.filter((c) => !VIRTUAL_ADAPTER.test(c.name));
  const pool = physical.length > 0 ? physical : found;

  for (const range of PRIVATE_RANGES) {
    const match = pool.find((c) => range.test(c.address));
    if (match) return match.address;
  }

  if (pool.length > 0) return pool[0].address;

  throw new Error(
    'No non-loopback IPv4 address found. These specs must run against a LAN ' +
      'address — on loopback a browser accepts Secure cookies over plain HTTP ' +
      'and the transport bugs under test cannot reproduce. Set E2E_HOST to an ' +
      'address this machine is reachable at.'
  );
}

const PORT = Number(process.env.E2E_PORT || 5100);

function resolveBaseUrl() {
  return `http://${resolveLanHost()}:${PORT}`;
}

module.exports = { resolveLanHost, resolveBaseUrl, PORT };
