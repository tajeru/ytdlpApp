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

    // メニューの定義
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
      },
      {
        label: 'Update',
        submenu: [
          {
            label: 'yt-dlpの更新',
            click: () => {
              // メニューから「yt-dlpの更新」が選ばれたとき、update-ytdlp-request イベントを送信
              mainWindow.webContents.send('update-ytdlp');
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
    "music-wav": `"${ytDlpPath}" -x --audio-format wav --audio-quality 0`,
    "itunes": `"${ytDlpPath}" -x --audio-format m4a --audio-quality 0 --embed-thumbnail --add-metadata --postprocessor-args "ffmpeg:-movflags +faststart"`,
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

     // Windows環境で日本語出力が文字化けしないように、環境変数 PYTHONIOENCODING を 'utf-8' に設定
     const child = spawn(fullCommand, {
       shell: true,
       env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
     });

     let outputData = ""; // stdout, stderr の出力を蓄積

     child.stdout.on('data', (data) => {
       const text = data.toString();
       outputData += text;
       event.reply('command-progress', text);
     });
     child.stderr.on('data', (data) => {
       const text = data.toString();
       outputData += text;
       event.reply('command-progress', text);
     });
     child.on('close', (code) => {
       if (code === 0) {
         // 終了コードが0なら常に成功
         event.reply('command-output', "ダウンロードできました");
       } else if (code === 1) {
         // 終了コード1の場合、出力内に特定の文字列が含まれるかチェック
         if (outputData.includes("すでに存在しています") || outputData.includes("変換は不要です")) {
           event.reply('command-output', "ダウンロードできました（警告メッセージ：" + outputData.trim() + "）");
         } else {
           event.reply('command-output', "エラーが発生しました！（終了コード: " + code + "）\n" + outputData);
         }
       } else {
         event.reply('command-output', "エラーが発生しました！（終了コード: " + code + "）\n" + outputData);
       }
     });
   } else {
     event.reply('command-output', '無効なコマンドです！');
   }
 });


  // yt-dlp の更新リクエストを受け取る
  ipcMain.on('update-ytdlp-request', (event) => {
    // yt-dlp のアップデートコマンド（-U オプション）
    const updateCommand = `"${ytDlpPath}" -U`;
    console.log('Updating yt-dlp: ' + updateCommand);

    const child = spawn(updateCommand, { shell: true });
    let updateOutput = '';

    child.stdout.on('data', (data) => {
      updateOutput += data.toString();
    });
    child.stderr.on('data', (data) => {
      updateOutput += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        // コマンド出力から判断する（"Updated" が含まれていれば最新版）
        let message = '';
        if (updateOutput.includes("up-to-date") || updateOutput.includes("Updated")) {
           message = '最新版になりました。';
        } else {
           message = 'すでに最新版です。';
        }
        dialog.showMessageBox(mainWindow, {
           type: 'info',
           title: 'yt-dlpの更新',
           message: message,
           detail: updateOutput
        });
        event.reply('update-ytdlp-response', message + "\n" + updateOutput);
      } else {
        dialog.showMessageBox(mainWindow, {
           type: 'error',
           title: 'yt-dlp更新エラー',
           message: 'yt-dlpの更新に失敗しました。',
           detail: `終了コード: ${code}\n${updateOutput}`
        });
        event.reply('update-ytdlp-response', `yt-dlpの更新に失敗しました。（終了コード: ${code}）\n${updateOutput}`);
      }
    });
  });


})();
