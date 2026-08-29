import type { Preview } from '@storybook/react';
import '../src/web/shared/styles/tokens.css';
import '../src/web/shared/styles/global.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: '主题',
      defaultValue: 'dark',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'dark', title: '深色' },
          { value: 'light', title: '浅色' },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.dataset.theme = context.globals.theme === 'light' ? 'light' : 'dark';
      return Story();
    },
  ],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'error' },
  },
};

export default preview;
