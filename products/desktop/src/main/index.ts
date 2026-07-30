import { app, Menu } from 'electron';
import { createDesktopShell } from './desktop-shell';
import { resolvePackagedDesktopPaths } from './packaged-paths';
import { PackagedSupervisor } from './packaged-supervisor';

function ignoreConsoleBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') return;
  });
}

ignoreConsoleBrokenPipe(process.stdout);
ignoreConsoleBrokenPipe(process.stderr);

app.setName('Glimmer Cradle');
process.title = 'Glimmer Cradle';

let packagedSupervisor: PackagedSupervisor | null = null;
let finalQuit = false;
const shell = createDesktopShell(async () => {
  await packagedSupervisor?.stop();
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lociere.glimmercradle');
  }
  if (app.isPackaged) {
    const paths = await resolvePackagedDesktopPaths({
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
    });
    packagedSupervisor = new PackagedSupervisor(paths);
    await packagedSupervisor.start();
  }
  Menu.setApplicationMenu(null);
  shell.start();
}).catch((error) => {
  console.error('Desktop packaged supervisor 启动失败', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // Glimmer Cradle 是托盘驻留应用；窗口关闭只隐藏，真正退出走托盘菜单。
});

app.on('activate', () => {
  shell.activate();
});

app.on('before-quit', (event) => {
  if (!finalQuit && packagedSupervisor && packagedSupervisor.getSnapshot().state !== 'stopped') {
    event.preventDefault();
    finalQuit = true;
    shell.dispose();
    void packagedSupervisor.stop().finally(() => app.quit());
    return;
  }
  shell.dispose();
});
