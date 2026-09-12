# ロジック検証

Node.jsでリポジトリのルートから実行します。追加パッケージは不要です。

```sh
node tests/inventory.cjs
node tests/cloud.cjs
```

クラウドテストはAPIの模擬応答による検証です。Supabaseの実接続・RLSは初期設定後に確認してください。
