import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { SoundbarAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class SamsungSoundbarPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    if (!config.host) {
      this.log.error('No "host" configured. Set the soundbar IP address.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.publish();
    });
  }

  /**
   * Television services must be published as external accessories: HomeKit
   * only allows one TV per bridge, so it gets its own pairing entry.
   */
  private publish(): void {
    const name = (this.config.name as string) ?? 'Soundbar';
    const uuid = this.api.hap.uuid.generate(
      `${PLUGIN_NAME}-${this.config.host}`,
    );

    const accessory = new this.api.platformAccessory(name, uuid);
    accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;

    new SoundbarAccessory(this, accessory);

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    this.log.info(
      `Published "${name}" at ${this.config.host}. ` +
        'Add it in the Home app using the Homebridge PIN.',
    );
  }

  /** Required by the interface. Nothing cached, since we publish externally. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }
}

export { PLATFORM_NAME, PLUGIN_NAME };
