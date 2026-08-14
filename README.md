# homebridge-samsung-soundbar-local

Local HomeKit control of Samsung D-series and later soundbars. No SmartThings account, no cloud round trip, no internet dependency.

Samsung's soundbars support AirPlay 2 but never register as HomeKit accessories, which is why the Home app's Add Accessory flow fails on them. This plugin fills that gap by talking directly to the soundbar's on-board IP Control server.

Verified against **HW-Q930D** (identifier `22_AV_HW-Q930D`).

Expected to also work on: HW-Q990D, HW-Q800D, HW-QS730D, HW-S800D, HW-S801D, HW-S700D, HW-S60D, HW-S61D, HW-LS60D, and the F-series equivalents. C-series and earlier do **not** have this interface.

## What you get in HomeKit

- Power on and off
- Input selection (eARC, ARC, HDMI 1, HDMI 2, Optical, Bluetooth, Wi-Fi)
- Volume, as both a slider and hardware button control
- Mute

## Install

```bash
npm install -g @snapeos/homebridge-samsung-soundbar-local
```

Then add to your Homebridge config, or use the Config UI X form:

```json
{
  "platforms": [
    {
      "platform": "SamsungSoundbarLocal",
      "name": "Soundbar",
      "host": "192.168.0.45",
      "maxVolume": 100,
      "pollInterval": 10
    }
  ]
}
```

Give the soundbar a DHCP reservation first, otherwise the plugin breaks whenever the lease changes.

### Pairing

The soundbar is published as an **external accessory**, because HomeKit permits only one Television service per bridge. After restarting Homebridge, open the Home app, choose Add Accessory, then "More options", and the soundbar will appear as a separate device. Pair it with the same PIN as your Homebridge bridge.

## Protocol notes

The soundbar runs a JSON-RPC 2.0 service over TLS on port 1516, behind a self-signed certificate issued to "Samsung IP Control G2".

Two traps worth documenting, since both cost time to find:

1. **The `Accept` header is mandatory.** The server content-negotiates. Send a perfectly valid JSON-RPC body without `Accept: application/json` and it returns `400 Bad Request` with a `text/xml` content type, which strongly implies the wrong protocol rather than a missing header.

2. **TLS verification must be off.** The certificate is self-signed and shared across Samsung display products.

### Handshake

```bash
curl -sk https://192.168.0.45:1516/ \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"jsonrpc":"2.0","method":"createAccessToken","id":1}'
```

Returns an `AccessToken` which must be passed in `params` on every subsequent call.

### Methods

| Method | Parameter | Values |
| --- | --- | --- |
| `powerControl` | `power` | `powerOn`, `powerOff` |
| `getVolume` | none | returns current level |
| `getMute` | none | returns mute state |
| `remoteKeyControl` | `remoteKey` | `VOL_UP`, `VOL_DOWN`, `MUTE`, `WOOFER_PLUS`, `WOOFER_MINUS` |
| `inputSelectControl` | `inputSource` | `HDMI_IN1`, `HDMI_IN2`, `E_ARC`, `ARC`, `D_IN`, `BT`, `WIFI_IDLE` |
| `soundModeControl` | `soundMode` | `STANDARD`, `SURROUND`, `GAME`, `MOVIE`, `MUSIC`, `CLEARVOICE`, `DTS_VIRTUAL_X`, `ADAPTIVE` |
| `getCodec` | none | current audio codec |
| `getIdentifier` | none | model string |

Calling `powerControl`, `inputSelectControl` or `soundModeControl` **without** their value parameter returns the current state instead of setting it.

### Absolute volume

There is no absolute volume setter. `setVolume` in this plugin reads the current level and issues repeated `VOL_UP` or `VOL_DOWN` presses until it matches, capped at 25 steps per request so a slider drag cannot flood the device.

## Testing without Homebridge

```bash
node test-soundbar.mjs 192.168.0.45
node test-soundbar.mjs 192.168.0.45 --volume-probe
```

The probe steps the volume up three and back down three, printing the reading each time. Use it to confirm the scale of your model, then set `maxVolume` to match.

The API level matches the number on the soundbar's front panel exactly. The HW-Q930D tops out at 100, which is the default. Setting `maxVolume` below your hardware maximum spreads the HomeKit slider across only the range you actually use, and acts as a volume limit.

## Credits

Protocol behaviour derived from [ZtF/hass-samsung-soundbar-local](https://github.com/ZtF/hass-samsung-soundbar-local), which did the original reverse engineering for Home Assistant.

## Licence

[MIT](LICENSE) © Andrew Snape
