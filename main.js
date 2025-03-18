const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  // 動的に ES Module として読み込む
  const isDevModule = await import('electron-is-dev');
  const isDev = isDevModule.default;

  // 開発時は __dirname を利用、ビルド後は process.resourcesPath + "app" を利用
  const ytDlpPath = isDev
    ? path.join(__dirname, 'bin', 'yt-dlp.exe')
    : path.join(process.resourcesPath, 'app', 'bin', 'yt-dlp.exe');

  const ffmpegPath = isDev
    ? path.join(__dirname, 'bin', 'ffmpeg.exe')
    : path.join(process.resourcesPath, 'app', 'bin', 'ffmpeg.exe');

  let mainWindow;

  app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    mainWindow.loadFile('index.html');

    // index.html の読み込みが完了したら、package.json からバージョンを読み込み送信する
    mainWindow.webContents.on('did-finish-load', () => {
      const pkg = require(path.join(app.getAppPath(), 'package.json'));
      mainWindow.webContents.send('app-version', pkg.version);
    });

    // メニューの定義（View メニューに「保存先リセット」を追加）
    const menuTemplate = [
      {
        label: 'File',
        submenu: [
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forcereload' },
          { role: 'toggledevtools' },
          { type: 'separator' },
          {
            label: '保存先リセット',
            click: () => {
              // ユーザーが「保存先リセット」を選んだ場合のみ、renderer にリセット通知を送信
              mainWindow.webContents.send('reset-save-folder');
            }
          },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Learn More',
            click: async () => {
              const { shell } = require('electron');
              await shell.openExternal('https://electronjs.org');
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
  });

  // コマンドのリスト（出力パスは後で動的に設定）
  const commands = {
    "music": `"${ytDlpPath}" -x --audio-format m4a --audio-quality 0`,
    "video": `"${ytDlpPath}" --recode-video mp4`,
    "playlist-music": `"${ytDlpPath}" -f b -x --audio-format m4a --audio-quality 0`,
    "playlist-video": `"${ytDlpPath}" --recode-video mp4`
  };

  // 保存先フォルダ選択のリクエストを受信
  ipcMain.on('select-save-folder', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "保存先フォルダを選択",
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      event.reply('folder-selected', result.filePaths[0]);
    } else {
      event.reply('folder-selected', null);
    }
  });

  ipcMain.on('execute-command', (event, data) => {
    let { commandKey, url, saveFolder } = data;
    console.log('Received command: ' + commandKey + ' with URL: ' + url + ', saveFolder: ' + saveFolder);

    // 音楽、ビデオの場合は URL のチェックとクリーンアップ
    if ((commandKey === "music" || commandKey === "video")) {
      if (!url || url.trim() === "") {
        event.reply('command-output', 'エラー: 適切なURLを入力してください！');
        return;
      }
      try {
        const parsedUrl = new URL(url);
        if ((parsedUrl.hostname.includes("youtube.com") || parsedUrl.hostname.includes("youtu.be")) &&
            parsedUrl.searchParams.has("v")) {
          url = `${parsedUrl.origin}${parsedUrl.pathname}?v=${parsedUrl.searchParams.get("v")}`;
        }
      } catch (e) {
        event.reply('command-output', 'エラー: URLの解析に失敗しました！');
        return;
      }
    }

    if (commands[commandKey]) {
      let fullCommand = commands[commandKey];
      // 保存先の指定（saveFolder がある場合）
      if (saveFolder && saveFolder.trim() !== "") {
        fullCommand += ` -o "${saveFolder}/%(title)s.%(ext)s"`;
      }
      // URLが入力されている場合、コマンドに引数として連結
      if (url && url.trim() !== "") {
        fullCommand += ' ' + url;
      }
      console.log('Executing command: ' + fullCommand);

      const child = spawn(fullCommand, { shell: true });
      child.stdout.on('data', (data) => {
        event.reply('command-progress', data.toString());
      });
      child.stderr.on('data', (data) => {
        event.reply('command-progress', data.toString());
      });
      child.on('close', (code) => {
        if (code === 0) {
          event.reply('command-output', `ダウンロードできました`);
        } else {
          event.reply('command-output', `エラーが発生しました！（終了コード: ${code}）`);
        }
      });
    } else {
      event.reply('command-output', '無効なコマンドです！');
    }
  });
})();
