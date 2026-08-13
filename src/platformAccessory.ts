import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { SamsungSoundbarPlatform } from './platform.js';
import {
  SoundbarClient,
  type InputSource,
  type SoundbarStatus,
} from './soundbar.js';

/** Order here defines the identifier numbering HomeKit uses. */
const ALL_INPUTS: { id: InputSource; label: string }[] = [
  { id: 'E_ARC', label: 'TV eARC' },
  { id: 'ARC', label: 'TV ARC' },
  { id: 'HDMI_IN1', label: 'HDMI 1' },
  { id: 'HDMI_IN2', label: 'HDMI 2' },
  { id: 'D_IN', label: 'Optical' },
  { id: 'BT', label: 'Bluetooth' },
  { id: 'WIFI_IDLE', label: 'Wi-Fi' },
];

export class SoundbarAccessory {
  private readonly tv: Service;
  private readonly speaker: Service;
  private readonly client: SoundbarClient;

  private readonly inputs: { id: InputSource; label: string }[];
  private readonly maxVolume: number;

  private status: SoundbarStatus = {
    power: false,
    volume: 0,
    mute: false,
    input: 'E_ARC',
    soundMode: 'STANDARD',
  };

  /** Guards the stepping loop so overlapping slider drags don't stack up. */
  private settingVolume = false;

  /** Debounces the confirming poll after a command. */
  private settleTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: SamsungSoundbarPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Characteristic, Service: S } = this.platform.api.hap;
    const config = this.platform.config;

    this.client = new SoundbarClient(
      config.host as string,
      (config.port as number) ?? 1516,
    );
    this.maxVolume = (config.maxVolume as number) ?? 40;

    const enabled = (config.inputs as string[]) ?? ALL_INPUTS.map((i) => i.id);
    this.inputs = ALL_INPUTS.filter((i) => enabled.includes(i.id));

    // --- accessory information -------------------------------------------
    (
      this.accessory.getService(S.AccessoryInformation) ??
      this.accessory.addService(S.AccessoryInformation)
    )
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(
        Characteristic.Model,
        (config.model as string) ?? 'Q-Series Soundbar',
      )
      .setCharacteristic(
        Characteristic.SerialNumber,
        (config.host as string) ?? 'unknown',
      );

    // --- television service ----------------------------------------------
    this.tv =
      this.accessory.getService(S.Television) ??
      this.accessory.addService(S.Television);

    this.tv
      .setCharacteristic(Characteristic.ConfiguredName, accessory.displayName)
      .setCharacteristic(
        Characteristic.SleepDiscoveryMode,
        Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.tv
      .getCharacteristic(Characteristic.Active)
      .onGet(() => (this.status.power ? 1 : 0))
      .onSet(this.setActive.bind(this));

    this.tv
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.identifierFor(this.status.input))
      .onSet(this.setActiveIdentifier.bind(this));

    // --- input sources ----------------------------------------------------
    this.inputs.forEach((input, index) => {
      const subtype = `input-${input.id}`;
      const service =
        this.accessory.getServiceById(S.InputSource, subtype) ??
        this.accessory.addService(S.InputSource, input.label, subtype);

      service
        .setCharacteristic(Characteristic.Identifier, index)
        .setCharacteristic(Characteristic.ConfiguredName, input.label)
        .setCharacteristic(
          Characteristic.IsConfigured,
          Characteristic.IsConfigured.CONFIGURED,
        )
        .setCharacteristic(
          Characteristic.InputSourceType,
          Characteristic.InputSourceType.HDMI,
        )
        .setCharacteristic(
          Characteristic.CurrentVisibilityState,
          Characteristic.CurrentVisibilityState.SHOWN,
        );

      this.tv.addLinkedService(service);
    });

    // --- speaker service --------------------------------------------------
    this.speaker =
      this.accessory.getService(S.TelevisionSpeaker) ??
      this.accessory.addService(S.TelevisionSpeaker);

    this.speaker
      .setCharacteristic(
        Characteristic.Active,
        Characteristic.Active.ACTIVE,
      )
      .setCharacteristic(
        Characteristic.VolumeControlType,
        Characteristic.VolumeControlType.ABSOLUTE,
      );

    this.speaker
      .getCharacteristic(Characteristic.VolumeSelector)
      .onSet(this.setVolumeSelector.bind(this));

    this.speaker
      .getCharacteristic(Characteristic.Mute)
      .onGet(() => this.status.mute)
      .onSet(this.setMute.bind(this));

    this.speaker
      .getCharacteristic(Characteristic.Volume)
      .onGet(() => this.toPercent(this.status.volume))
      .onSet(this.setVolume.bind(this));

    this.tv.addLinkedService(this.speaker);

    // --- polling ----------------------------------------------------------
    const interval = ((config.pollInterval as number) ?? 10) * 1000;
    void this.poll();
    setInterval(() => void this.poll(), interval);
  }

  // ------------------------------------------------------------------ helpers

  private identifierFor(source: InputSource): number {
    const index = this.inputs.findIndex((i) => i.id === source);
    return index >= 0 ? index : 0;
  }

  private toPercent(raw: number): number {
    return Math.max(0, Math.min(100, Math.round((raw / this.maxVolume) * 100)));
  }

  private fromPercent(percent: number): number {
    return Math.round((percent / 100) * this.maxVolume);
  }

  // ------------------------------------------------------------------ polling

  private async poll(): Promise<void> {
    const { Characteristic } = this.platform.api.hap;
    try {
      const status = await this.client.getStatus();
      this.status = status;

      this.tv.updateCharacteristic(Characteristic.Active, status.power ? 1 : 0);
      this.tv.updateCharacteristic(
        Characteristic.ActiveIdentifier,
        this.identifierFor(status.input),
      );
      this.speaker.updateCharacteristic(Characteristic.Mute, status.mute);
      this.speaker.updateCharacteristic(
        Characteristic.Volume,
        this.toPercent(status.volume),
      );
    } catch (err) {
      this.platform.log.debug(
        'Poll failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Schedule a confirming poll. The soundbar's getters lag roughly one command
   * behind, so reading immediately after a write returns the previous value.
   */
  private refreshSoon(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => void this.poll(), SoundbarClient.SETTLE_MS);
  }

  // ------------------------------------------------------------------ setters

  private async setActive(value: CharacteristicValue): Promise<void> {
    const on = value === 1;
    await this.client.setPower(on);
    this.status.power = on;
    this.refreshSoon();
    this.platform.log.info(`Power ${on ? 'on' : 'off'}`);
  }

  private async setActiveIdentifier(value: CharacteristicValue): Promise<void> {
    const input = this.inputs[value as number];
    if (!input) {
      return;
    }
    await this.client.setInput(input.id);
    this.status.input = input.id;
    this.refreshSoon();
    this.platform.log.info(`Input set to ${input.label}`);
  }

  private async setMute(value: CharacteristicValue): Promise<void> {
    // The protocol only offers a toggle, so only act on an actual change.
    if (value === this.status.mute) {
      return;
    }
    await this.client.toggleMute();
    this.status.mute = value as boolean;
    this.refreshSoon();
  }

  private async setVolumeSelector(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform.api.hap;
    if (value === Characteristic.VolumeSelector.INCREMENT) {
      await this.client.volumeUp();
      this.status.volume++;
    } else {
      await this.client.volumeDown();
      this.status.volume--;
    }
    this.refreshSoon();
  }

  private async setVolume(value: CharacteristicValue): Promise<void> {
    if (this.settingVolume) {
      return;
    }
    this.settingVolume = true;
    try {
      const target = this.fromPercent(value as number);
      this.status.volume = await this.client.setVolume(target);
      this.refreshSoon();
    } finally {
      this.settingVolume = false;
    }
  }
}
