# GitHub + GitHub Pages 公開フロー

静的Webゲーム／アプリを GitHub Pages で公開し、継続的に開発する手順。

---

## 1. 初回セットアップ

### リポジトリ作成・初期コミット

```powershell
cd <プロジェクトフォルダ>
git init
git add .
git commit -m "initial commit"
```

### GitHub にリモートを作成してプッシュ

```powershell
gh repo create <リポジトリ名> --public --source=. --remote=origin --push
```

> `gh` コマンドが使えない場合は `winget install GitHub.cli` でインストール後、`gh auth login` で認証する。

---

## 2. GitHub Pages を有効化

```powershell
gh api repos/<ユーザー名>/<リポジトリ名>/pages `
  --method POST `
  -F "source[branch]=main" `
  -F "source[path]=/"
```

> **注意**: `--field source='{"branch":"main","path":"/"}'` のようにJSONを文字列で渡す書き方は失敗する。`-F "source[branch]=..."` の形式を使うこと。

公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/` になる。  
有効化直後は数分かかる場合がある。

---

## 3. 日常の開発サイクル

```powershell
# ファイルを編集したら
git add <変更ファイル>
git commit -m "変更内容の説明"
git push
```

プッシュ後、GitHub Pages に反映されるまで **1〜2分** 待つ。

---

## 4. ローカルプレビュー

Python が入っていれば簡易サーバーを立てて `file://` 問題を回避できる。

```powershell
python -m http.server 3333
# → http://localhost:3333 でアクセス
```

`.claude/launch.json` に設定しておくと Claude Code から起動できる。

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "dev-server",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "3333"],
      "port": 3333
    }
  ]
}
```

---

## 5. PeerJS を使った P2P マルチプレイヤー（オプション）

サーバー不要でリアルタイム通信を追加できる。

```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```

### 合言葉マッチング方式

両者が同じ合言葉を入力すると自動でマッチする仕組み。サーバー不要。

```js
// 合言葉 → PeerJS ID（FNV-1a ハッシュ）
function passphraseToId(passphrase) {
  let hash = 0x811c9dc5;
  const s = passphrase.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 'prefix-' + hash.toString(36);
}

// 同じIDで Peer 作成を試みる
// → 成功 = ホスト（相手の接続を待つ）
// → unavailable-id エラー = ゲスト（ホストに接続しにいく）
const peer = new Peer(passphraseToId(passphrase));
peer.on('open', () => { /* ホスト処理 */ });
peer.on('error', e => {
  if (e.type === 'unavailable-id') { /* ゲスト処理 */ }
});
```

---

## 6. よくあるトラブル

| 症状 | 原因 | 対処 |
|------|------|------|
| `gh` が bash で見つからない | PATH が更新されていない | PowerShell で実行する |
| Pages が 404 | 有効化直後 | 数分待つ |
| Pages API が 422 | JSONを文字列で渡している | `-F "source[branch]=main"` 形式を使う |
| 音が鳴らない（スマホ） | AudioContext が suspended | ボタンクリック時に `ctx.resume()` を呼ぶ |
| 音が割れる | gain > 1.0 | DynamicsCompressor を挟み gain を 1.0 以下にする |
