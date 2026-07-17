import { BaseExtension } from '@glimmer-cradle/extension-sdk';
import { MyExtensionConfig, MyExtensionConfigSchema } from '../config/schema';

export class MyExtension extends BaseExtension<MyExtensionConfig> {
  constructor() {
    super(MyExtensionConfigSchema);
  }

  protected override async activate(): Promise<void> {
    if (this.config.commands.ping) {
      this.registerCommand(
        'your-publisher.my-extension.ping',
        async () => this.handlePing(),
        {
          title: 'Ping My Extension',
          category: 'My Extension',
        },
      );
    }

    this.logger.info('[your-publisher.my-extension] activated');
  }

  protected override async deactivate(): Promise<void> {
    this.logger.info('[your-publisher.my-extension] deactivated');
  }

  private handlePing(): { message: string } {
    return {
      message: this.config.messages.greeting,
    };
  }
}
