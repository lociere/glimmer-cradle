import { app, Menu } from 'electron';
import { createDesktopShell } from './desktop-shell';

function ignoreConsoleBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') return;
  });
}

ignoreConsoleBrokenPipe(process.stdout);
ignoreConsoleBrokenPipe(process.stderr);

app.setName('Glimmer Cradle');
process.title = 'Glimmer Cradle';

const shell = createDesktopShell();

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lociere.glimmercradle');
  }
  Menu.setApplicationMenu(null);
  shell.start();
});

app.on('window-all-closed', () => {
  // Glimmer Cradle 是托盘驻留应用；窗口关闭只隐藏，真正退出走托盘菜单。
});

app.on('activate', () => {
  shell.activate();
});

app.on('before-quit', () => {
  shell.dispose();
});
