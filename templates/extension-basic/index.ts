/**
 * 扩展入口。
 *
 * 这里只声明扩展实例与 manifest 补充信息；具体业务逻辑放在 src/ 下。
 */
import { defineExtension } from '@glimmer-cradle/extension-sdk';
import { BuiltInContributionPoint } from '@glimmer-cradle/extension-sdk/manifest';
import { MyExtension } from './src/my-extension';

export default defineExtension({
  manifest: {
    engines: {
      glimmerCradle: '0.1.0',
    },
    requires: ['commands'],
    activationEvents: ['onStartup', 'onCommand:your-publisher.my-extension.ping'],
    contributes: {
      [BuiltInContributionPoint.command]: [
        {
          id: 'your-publisher.my-extension.ping',
          command: 'your-publisher.my-extension.ping',
          title: 'Ping My Extension',
          audience: 'user',
          scope: { kind: 'global' },
          requirements: {
            products: ['any'],
            platforms: ['any'],
            features: ['extensions'],
            profiles: [],
          },
          category: 'My Extension',
          permissions: [],
          dependsOn: [],
          metadata: {},
          actionKind: 'command',
          preconditions: [],
        },
      ],
      [BuiltInContributionPoint.setting]: [
        {
          id: 'greeting',
          key: 'greeting',
          title: '问候语',
          description: '模板扩展返回的默认问候文本。',
          audience: 'user',
          scope: { kind: 'global' },
          requirements: {
            products: ['any'],
            platforms: ['any'],
            features: ['extensions'],
            profiles: [],
          },
          permissions: [],
          dependsOn: [],
          metadata: {},
          type: 'string',
          default: 'hello',
          requiresRestart: false,
          secret: false,
        },
      ],
    },
  },
  extension: new MyExtension(),
});
