const { ipcRenderer, clipboard } = require('electron');

// DOMContentLoaded 時は、localStorage から保存先を読み込む（起動時の自動リセットは行わない）
document.addEventListener('DOMContentLoaded', () => {
  const savedFolder = localStorage.getItem('saveFolder');
  if (savedFolder) {
    document.getElementById('save-folder-display').innerText = savedFolder;
  }
});

// フォルダ選択ボタンの動作
document.getElementById('select-folder').addEventListener('click', () => {
  ipcRenderer.send('select-save-folder');
});

// 保存先が選択されたら表示し、localStorage に保存
ipcRenderer.on('folder-selected', (event, folderPath) => {
  if (folderPath) {
    document.getElementById('save-folder-display').innerText = folderPath;
    localStorage.setItem('saveFolder', folderPath);
  } else {
    alert('フォルダが選択されませんでした。');
  }
});

document.getElementById('run-command').addEventListener('click', () => {
  const selectedOption = document.querySelector('input[name="command"]:checked');
  const url = document.getElementById('url-input').value;
  const saveFolder = document.getElementById('save-folder-display').innerText;
  if (selectedOption) {
    // 送信前に進捗ログをクリア
    document.getElementById('progress-output').innerText = "";
    ipcRenderer.send('execute-command', { commandKey: selectedOption.value, url: url, saveFolder: saveFolder });
    document.getElementById('status').innerText = "実行中...";
  } else {
    alert("コマンドを選択してください！");
  }
});

// 最終結果が届いたとき
ipcRenderer.on('command-output', (event, message) => {
  document.getElementById('status').innerText = message;
  appendLog(message + "\n");
});

// 進捗メッセージが届いたとき
ipcRenderer.on('command-progress', (event, progressData) => {
  appendLog(progressData);
});

function appendLog(text) {
  const logContainer = document.getElementById('progress-output');
  logContainer.innerText += text;
  logContainer.scrollTop = logContainer.scrollHeight;
}

// リセットボタンの動作（URL 用）
document.getElementById('reset-url').addEventListener('click', () => {
  document.getElementById('url-input').value = "";
});

// 貼り付けボタンの動作
document.getElementById('paste-url').addEventListener('click', () => {
  try {
    const clipboardText = clipboard.readText();
    document.getElementById('url-input').value = clipboardText;
  } catch (error) {
    console.error('クリップボードの読み取りに失敗:', error);
    alert('クリップボードの内容を取得できませんでした。');
  }
});

// main.js から送られてきたアプリのバージョンを受け取り表示（自動リセットは行わない）
ipcRenderer.on('app-version', (event, version) => {
  localStorage.setItem('appVersion', version);
  document.getElementById('app-version').innerText = `v${version}`;
});

// メニューから送られてくる「保存先リセット」イベントを受け取る
ipcRenderer.on('reset-save-folder', () => {
  localStorage.removeItem('saveFolder');
  document.getElementById('save-folder-display').innerText = '';
});
