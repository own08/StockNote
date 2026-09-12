// 公開してよい接続情報のみを設定します。service_role / secret キーは絶対に使わないでください。
window.STOCK_CONFIG = {
  mode: 'cloud', // ローカル専用に戻す場合は 'local'
  supabaseUrl: '', // 例: https://your-project.supabase.co
  supabasePublishableKey: '' // sb_publishable_... または legacy anon キー
};
