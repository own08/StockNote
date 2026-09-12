'use strict';
// No admin credentials: every request is authenticated as the signed-in user.
window.StockCloud = (() => {
  const cfg=window.STOCK_CONFIG||{}, enabled=cfg.mode==='cloud';
  let session=null, revision=0, pending=null, busy=false, ready=false, refreshing=null, reading=false, timer=null;
  const url=String(cfg.supabaseUrl||'').replace(/\/$/,''), key=String(cfg.supabasePublishableKey||'');
  const sessionKey='stock-note-session:'+url;
  function publicKeyValid(){if(key.startsWith('sb_publishable_'))return true;try{return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon'}catch{return false}}
  const draftKey=()=> 'stock-note-draft:'+url+':'+session.user.id;
  const node=id=>document.getElementById(id);
  function status(message,problem=false){node('sync-message').textContent=message;node('sync-bar').classList.toggle('problem',problem);node('sync-retry').hidden=!pending||busy;node('sync-discard').hidden=!pending||busy;node('sync-draft').hidden=!pending;node('sync-refresh').disabled=busy||!!pending;node('sync-logout').disabled=busy;}
  function lock(){document.querySelector('main').inert=!ready||!!pending||busy;}
  function rememberSession(value){session=value;session.expires_at=session.expires_at||Math.floor(Date.now()/1000)+session.expires_in;try{sessionStorage.setItem(sessionKey,JSON.stringify(session))}catch{/* Login can still work until the page is closed. */}}
  async function request(path,{body,token}={}){
    let response;
    try{response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000),cache:'no-store'})}
    catch{throw Error('通信できません。接続を確認して再試行してください。')}
    const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{throw Error('保存先からの応答を読み取れませんでした。')}
    if(!response.ok){const err=Error(data?.message==='REVISION_CONFLICT'?'別の端末でデータが更新されています。未送信JSONを保存し、共有データを読み直してから変更を入れ直してください。':response.status===401||response.status===400&&path.startsWith('/auth/')?'ログイン情報または有効期限を確認してください。必要なら再ログインしてください。':response.status===429?'アクセスが集中しています。少し待って再試行してください。':'保存先に接続できません。接続設定・ログイン・データベース設定を確認してください。');err.code=data?.code;err.status=response.status;throw err}
    return data;
  }
  async function token(){
    if(!session)throw Error('ログインしてください。');
    if(session.expires_at*1000>Date.now()+60000)return session.access_token;
    if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}}).then(rememberSession).finally(()=>refreshing=null);
    await refreshing;return session.access_token;
  }
  async function read(){const data=await request('/rest/v1/stock_notes?select=payload,revision,mutation_id&user_id=eq.'+encodeURIComponent(session.user.id),{token:await token()});if(!Array.isArray(data)||data.length>1)throw Error('共有データの形式を確認してください。');if(data[0])validate(data[0].payload);return data[0]||null}
  function install(row){revision=row?.revision||0;db=row?validate(row.payload):fresh();loadError=false;render();ready=true;lock()}
  function clearDraft(){pending=null;try{sessionStorage.removeItem(draftKey())}catch{}}
  async function send(){
    if(!pending||busy)return;
    busy=true;lock();status('共有データを保存中…');
    try{
      const rows=await request('/rest/v1/rpc/save_stock_note',{token:await token(),body:{p_payload:pending.payload,p_expected_revision:pending.revision,p_mutation_id:pending.mutationId}});
      if(!Array.isArray(rows)||rows.length!==1)throw Error('保存結果を確認できません。再試行してください。');
      validate(rows[0].payload);clearDraft();install(rows[0]);status('✓ 同期済み · '+new Date().toLocaleTimeString('ja-JP'));notify('共有データに保存しました');
    }catch(e){status(e.message,true)}finally{busy=false;lock();if(pending)status(node('sync-message').textContent,true);else status(node('sync-message').textContent)}
  }
  function save(next){
    if(!ready||busy||pending){alert('同期処理が完了してから操作してください。');return false}
    try{
      validate(next);
      const draft={payload:structuredClone(next),revision,mutationId:crypto.randomUUID()};
      sessionStorage.setItem(draftKey(),JSON.stringify(draft));pending=draft;db=next;void send();return true;
    }catch(e){alert('変更を保存できませんでした：'+e.message);return false}
  }
  async function refresh(manual=false){
    if(!session||!ready||pending||busy||reading)return;
    if(node('dialog').open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(manual)status('入力を終えてから最新データを読み込んでください。');return}
    reading=true;const originalRevision=revision;
    try{const row=await read();if(pending||busy||revision!==originalRevision||node('dialog').open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if((row?.revision||0)!==revision){install(row);notify('別の端末での更新を反映しました')}status('✓ 同期済み · '+new Date().toLocaleTimeString('ja-JP'))}catch(e){status(e.message,true)}finally{reading=false}
  }
  async function enter(){
    const row=await read();install(row);
    node('login-panel').hidden=true;document.querySelector('main').hidden=false;node('sync-bar').hidden=false;node('sync-user').textContent=session.user.email||'ログイン中';
    const stored=sessionStorage.getItem(draftKey());
    if(stored){try{const d=JSON.parse(stored);validate(d.payload);if(!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.mutationId!=='string')throw Error();pending=d;db=d.payload;render();status('このタブに未送信の変更があります。再試行、または未送信JSONを保存して共有データを読み直してください。',true)}catch{status('未送信データを読み込めません。共有データを表示しています。',true)}}else status('✓ 同期済み');
    lock();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)void refresh()},12000);
  }
  function mount(){
    if(!enabled)return;
    document.querySelector('main').hidden=true;
    document.querySelector('.local').textContent='☁ 端末間で同期';
    document.querySelector('footer').textContent='Stock Note · 同じアカウントでPC・スマホのデータを共有 / 定期的なJSONバックアップをおすすめします。';
    const area=document.createElement('section');area.id='cloud-area';area.innerHTML=`<div id="sync-bar" class="syncbar" hidden><div><strong id="sync-user"></strong><p id="sync-message" role="status"></p></div><div class="toolbar"><button id="sync-refresh">最新に更新</button><button id="sync-draft" hidden>未送信JSONを保存</button><button id="sync-retry" hidden>再試行</button><button id="sync-discard" hidden>共有データを読み直す</button><button id="sync-logout">ログアウト</button></div></div><div id="login-panel" class="loginpanel"><small>YOUR SHARED INVENTORY</small><h1>どこからでも、同じ在庫を。</h1><p>PCとスマホで同じメールアドレスを使ってログインしてください。</p><form id="login-form"><label class="field">メールアドレス<input name="email" type="email" autocomplete="username" required></label><label class="field">パスワード<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">ログイン</button></form><p id="login-message" role="status"></p><p class="muted">個人用アカウントは管理者が保存先で作成します。</p></div>`;
    document.querySelector('header').after(area);
    node('sync-refresh').onclick=()=>void refresh(true);node('sync-retry').onclick=()=>void send();node('sync-draft').onclick=()=>download('stock-note-unsent-'+today()+'.json',JSON.stringify(pending.payload,null,2),'application/json');
    node('sync-discard').onclick=async()=>{if(!pending||busy)return;if(!confirm('未送信の変更を取り消して、共有データを読み直しますか？必要なら先に「未送信JSONを保存」を押してください。'))return;busy=true;lock();try{const row=await read();clearDraft();install(row);status('共有データを読み直しました')}catch(e){status(e.message,true)}finally{busy=false;lock();status(node('sync-message').textContent,!!pending)}};
    node('sync-logout').onclick=async()=>{
      if(busy)return;if(pending&&!confirm('未送信の変更があります。このタブには残りますが、タブを閉じると失われます。先にJSON保存をおすすめします。ログアウトしますか？'))return;
      busy=true;lock();try{await request('/auth/v1/logout?scope=local',{body:{},token:await token()})}catch{/* Remove this browser session even when offline. */}
      sessionStorage.removeItem(sessionKey);session=null;pending=null;ready=false;busy=false;db=fresh();clearInterval(timer);node('sync-bar').hidden=true;document.querySelector('main').hidden=true;node('login-panel').hidden=false;node('login-form').reset();node('login-message').textContent='ログアウトしました。';
    };
    node('login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;node('login-message').textContent='ログインしています…';try{const f=new FormData(e.target);rememberSession(await request('/auth/v1/token?grant_type=password',{body:{email:f.get('email').trim(),password:f.get('password')}}));await enter();e.target.reset()}catch(err){node('login-message').textContent=err.message}finally{button.disabled=false}};
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});window.addEventListener('online',()=>void refresh());window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue=''}});
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!publicKeyValid()){node('login-form').hidden=true;node('login-message').textContent='共有保存の初期設定が必要です。SETUP.mdに沿ってSupabaseを作成し、config.jsにProject URLと公開用キーを設定してください。';return}
    try{const old=sessionStorage.getItem(sessionKey);if(old){session=JSON.parse(old);void enter().catch(e=>{node('login-message').textContent=e.message})}}catch{session=null}
  }
  return {enabled,save,mount,get pending(){return !!pending},get busy(){return busy}};
})();
