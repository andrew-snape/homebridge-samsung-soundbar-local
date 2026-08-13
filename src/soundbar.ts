/**
 * Client for the Samsung "IP Control Server" JSON-RPC interface.
 *
 * Verified against HW-Q930D (identifier 22_AV_HW-Q930D) on port 1516.
 * Should also cover HW-Q990D, HW-Q800D, HW-QS730D, HW-S800D, HW-S801D,
 * HW-S700D, HW-S60D, HW-S61D, HW-LS60D and the F-series equivalents.
 *
 * Two non-obvious things about this endpoint:
 *   1. It is HTTPS with a self-signed Samsung cert, so TLS verification
 *      must be disabled.
 *   2. It content-negotiates on the Accept header. Without an explicit
 *      'Accept: application/json' it answers 400 with a text/xml body,
 *      even when the request itself is perfectly good JSON.
 */

import https from 'node:https';

export type InputSource =
  | 'HDMI_IN1'
  | 'HDMI_IN2'
  | 'E_ARC'
  | 'ARC'
  | 'D_IN'
  | 'BT'
  | 'WIFI_IDLE';

export type SoundMode =
  | 'STANDARD'
  | 'SURROUND'
  | 'GAME'
  | 'MOVIE'
  | 'MUSIC'
  | 'CLEARVOICE'
  | 'DTS_VIRTUAL_X'
  | 'ADAPTIVE';

export type RemoteKey =
  | 'VOL_UP'
  | 'VOL_DOWN'
  | 'MUTE'
  | 'WOOFER_PLUS'
  | 'WOOFER_MINUS';

export interface SoundbarStatus {
  power: boolean;
  volume: number;
  mute: boolean;
  input: InputSource;
  soundMode: SoundMode;
  identifier?: string;
}

export class SoundbarApiError extends Error {}

interface RpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: Record<string, unknown>;
  error?: unknown;
}

export class SoundbarClient {
  private token?: string;
  private inflight?: Promise<string>;

  constructor(
    private readonly host: string,
    private readonly port: number = 1516,
    private readonly timeoutMs: number = 8000,
  ) {}

  // ---------------------------------------------------------------- transport

  private post(payload: unknown): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: this.host,
          port: this.port,
          path: '/',
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            'Content-Type': 'application/json',
            // Required. Omitting this yields a 400 with an XML body.
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new SoundbarApiError(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
              return;
            }
            let parsed: RpcResponse;
            try {
              parsed = JSON.parse(data);
            } catch {
              reject(new SoundbarApiError(`Malformed response: ${data.slice(0, 200)}`));
              return;
            }
            if (parsed.error !== undefined) {
              reject(new SoundbarApiError(JSON.stringify(parsed.error)));
              return;
            }
            resolve(parsed.result ?? {});
          });
        },
      );

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new SoundbarApiError(`Timed out after ${this.timeoutMs}ms`));
      });
      req.on('error', (err) =>
        reject(err instanceof SoundbarApiError ? err : new SoundbarApiError(err.message)),
      );
      req.write(body);
      req.end();
    });
  }

  // ------------------------------------------------------------------- tokens

  /** Mint a token, coalescing concurrent requests so we only ever mint once. */
  private async ensureToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }
    if (!this.inflight) {
      this.inflight = this.post({ jsonrpc: '2.0', method: 'createAccessToken', id: 1 })
        .then((result) => {
          const token = result.AccessToken as string;
          if (!token) {
            throw new SoundbarApiError('No AccessToken in response');
          }
          this.token = token;
          return token;
        })
        .finally(() => {
          this.inflight = undefined;
        });
    }
    return this.inflight;
  }

  /** Drop the cached token. The next call will mint a fresh one. */
  invalidateToken(): void {
    this.token = undefined;
  }

  // --------------------------------------------------------------------- rpc

  private async call(
    method: string,
    params: Record<string, unknown> = {},
    isRetry = false,
  ): Promise<Record<string, unknown>> {
    const token = await this.ensureToken();
    const payload = {
      jsonrpc: '2.0',
      method,
      id: 1,
      params: { ...params, AccessToken: token },
    };

    try {
      return await this.post(payload);
    } catch (err) {
      // A stale token after a soundbar reboot looks like a generic failure,
      // so re-mint once and try again before giving up.
      if (!isRetry && err instanceof SoundbarApiError) {
        this.invalidateToken();
        return this.call(method, params, true);
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ getters

  async getPower(): Promise<boolean> {
    const r = await this.call('powerControl');
    return r.power === 'powerOn';
  }

  async getVolume(): Promise<number> {
    const r = await this.call('getVolume');
    return parseInt(String(r.volume), 10);
  }

  async getMute(): Promise<boolean> {
    const r = await this.call('getMute');
    return r.mute === true || r.mute === 'true' || r.mute === 'on';
  }

  async getInput(): Promise<InputSource> {
    const r = await this.call('inputSelectControl');
    return r.inputSource as InputSource;
  }

  async getSoundMode(): Promise<SoundMode> {
    const r = await this.call('soundModeControl');
    return r.soundMode as SoundMode;
  }

  async getIdentifier(): Promise<string | undefined> {
    const r = await this.call('getIdentifier');
    return r.identifier as string | undefined;
  }

  /** One consolidated poll. Sequential on purpose: the bar dislikes parallel calls. */
  async getStatus(): Promise<SoundbarStatus> {
    const power = await this.getPower();
    const volume = await this.getVolume();
    const mute = await this.getMute();
    const input = await this.getInput();
    const soundMode = await this.getSoundMode();
    return { power, volume, mute, input, soundMode };
  }

  // ------------------------------------------------------------------ setters

  async setPower(on: boolean): Promise<void> {
    await this.call('powerControl', { power: on ? 'powerOn' : 'powerOff' });
  }

  async setInput(source: InputSource): Promise<void> {
    await this.call('inputSelectControl', { inputSource: source });
  }

  async setSoundMode(mode: SoundMode): Promise<void> {
    await this.call('soundModeControl', { soundMode: mode });
  }

  async pressKey(key: RemoteKey): Promise<void> {
    await this.call('remoteKeyControl', { remoteKey: key });
  }

  async volumeUp(): Promise<void> {
    await this.pressKey('VOL_UP');
  }

  async volumeDown(): Promise<void> {
    await this.pressKey('VOL_DOWN');
  }

  async toggleMute(): Promise<void> {
    await this.pressKey('MUTE');
  }

  /**
   * There is no absolute volume setter in the protocol, so we step towards the
   * target. maxSteps caps the burst: a full-scale HomeKit slider drag would
   * otherwise fire a hundred sequential requests at the bar.
   *
   * We track the level locally rather than re-reading between presses, because
   * getVolume lags roughly one press behind at this cadence and would make the
   * loop overshoot. The caller gets the computed value; the next poll confirms.
   */
  async setVolume(target: number, maxSteps = 25): Promise<number> {
    let current = await this.getVolume();
    let steps = 0;
    while (current !== target && steps < maxSteps) {
      if (current < target) {
        await this.volumeUp();
        current++;
      } else {
        await this.volumeDown();
        current--;
      }
      steps++;
    }
    return current;
  }

  /** getVolume lags behind a press. Wait this long before trusting a reread. */
  static readonly SETTLE_MS = 900;
}
