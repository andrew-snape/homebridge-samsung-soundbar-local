#!/usr/bin/env node
/**
 * Standalone check against the real soundbar, no Homebridge required.
 *
 *   node test-soundbar.mjs 192.168.0.45
 *   node test-soundbar.mjs 192.168.0.45 --volume-probe
 *
 * The --volume-probe flag steps the volume up 3 and back down 3, printing the
 * reading at each step. That confirms the scale and that stepping is reliable.
 */

import https from 'node:https';

const host = process.argv[2];
const probe = process.argv.includes('--volume-probe');

if (!host) {
  console.error('Usage: node test-soundbar.mjs <ip> [--volume-probe]');
  process.exit(1);
}

let token;

function post(payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 1516,
        path: '/',
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
          }
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(JSON.stringify(p.error)));
            resolve(p.result ?? {});
          } catch (e) {
            reject(new Error(`Bad JSON: ${data.slice(0, 120)}`));
          }
        });
      },
    );
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function call(method, params = {}) {
  if (!token) {
    token = (await post({ jsonrpc: '2.0', method: 'createAccessToken', id: 1 })).AccessToken;
    console.log(`  token: ${token.slice(0, 12)}...`);
  }
  return post({ jsonrpc: '2.0', method, id: 1, params: { ...params, AccessToken: token } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`\nConnecting to ${host}:1516\n`);

  const id = await call('getIdentifier');
  console.log(`  model:      ${id.identifier}`);

  const power = await call('powerControl');
  console.log(`  power:      ${power.power}`);

  const vol = await call('getVolume');
  console.log(`  volume:     ${vol.volume}`);

  const mute = await call('getMute');
  console.log(`  mute:       ${JSON.stringify(mute)}`);

  const input = await call('inputSelectControl');
  console.log(`  input:      ${input.inputSource}`);

  const mode = await call('soundModeControl');
  console.log(`  sound mode: ${mode.soundMode}`);

  if (probe) {
    console.log('\nVolume probe (3 up, 3 down):');
    for (let i = 0; i < 3; i++) {
      await call('remoteKeyControl', { remoteKey: 'VOL_UP' });
      await sleep(300);
      const v = await call('getVolume');
      console.log(`  up   -> ${v.volume}`);
    }
    for (let i = 0; i < 3; i++) {
      await call('remoteKeyControl', { remoteKey: 'VOL_DOWN' });
      await sleep(300);
      const v = await call('getVolume');
      console.log(`  down -> ${v.volume}`);
    }
  }

  console.log('\nAll calls succeeded.\n');
})().catch((err) => {
  console.error(`\nFailed: ${err.message}\n`);
  process.exit(1);
});
