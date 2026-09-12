const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const url='https://test.supabase.co';let server=null,loseResponse=false,offline=false,refreshCount=0;
const fresh=()=>({version:1,brands:[],tags:[],products:[],orders:[],history:[]});
function browser(user='u1'){
 const nodes=new Map();function el(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,inert:false,open:false,textContent:'',classList:{toggle(){}},after(){},querySelector(){return el('submit')},reset(){}});return nodes.get(id)}
 const store=new Map([['stock-note-session:'+url,JSON.stringify({access_token:'token-'+user,refresh_token:'refresh-'+user,expires_at:Date.now()/1000+3600,user:{id:user,email:user+'@example.test'}})]]);
 const doc={getElementById:el,querySelector:el,createElement:()=>el('section'),addEventListener(){},activeElement:{tagName:'BODY'},hidden:false};
 const ctx={console,document:doc,window:{STOCK_CONFIG:{mode:'cloud',supabaseUrl:url,supabasePublishableKey:'sb_publishable_test'},addEventListener(){}},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},AbortSignal,crypto:crypto.webcrypto,structuredClone,Date,JSON,Error,atob,setInterval:()=>1,clearInterval(){},alert:s=>{throw Error(s)},confirm:()=>true,db:fresh(),loadError:false,validate:x=>{if(x.version!==1)throw Error('invalid');return x},fresh,render(){},notify(){},download(){},today:()=> '2026-09-13',fetch:async(path,opts)=>{
  if(offline)throw Error('offline');const body=opts.body?JSON.parse(opts.body):null;
  function response(data,status=200){return {ok:status<400,status,text:async()=>JSON.stringify(data)}}
  if(path.includes('/token?grant_type=refresh_token')){refreshCount++;return response({access_token:'token-'+user,refresh_token:'refresh-'+user,expires_in:3600,user:{id:user}})}
  assert.equal(opts.headers.apikey,'sb_publishable_test');assert.equal(opts.headers.Authorization,'Bearer token-'+user);
  if(path.includes('/rpc/')){
   if(server&&server.user!==user)throw Error('test mock only supports one owner');
   if(server?.mutation_id===body.p_mutation_id)return response([structuredClone(server)]);
   if((server?.revision||0)!==body.p_expected_revision)return response({message:'REVISION_CONFLICT',code:'40001'},409);
   server={user,payload:body.p_payload,revision:(server?.revision||0)+1,mutation_id:body.p_mutation_id};
   if(loseResponse){loseResponse=false;throw Error('lost response')}
   return response([structuredClone(server)]);
  }
  if(path.includes('/stock_notes?'))return response(server&&server.user===user?[structuredClone(server)]:[]);
  if(path.includes('/logout'))return response(null);
  throw Error('Unexpected path '+path);
 }};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','cloud.js'),'utf8'),ctx);ctx.window.StockCloud.mount();return {ctx,nodes,store,cloud:ctx.window.StockCloud};
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
(async()=>{
 const a=browser(),b=browser();await settle();assert.equal(a.nodes.get('main').hidden,false);
 let next=fresh();next.brands=['PC'];assert.equal(a.cloud.save(next),true);await settle();assert.equal(server.revision,1);assert.equal(a.cloud.pending,false);
 next=fresh();next.brands=['Phone'];b.cloud.save(next);await settle();assert.equal(b.cloud.pending,true);assert.equal(server.payload.brands[0],'PC');assert.equal(b.nodes.get('main').inert,true);
 await b.nodes.get('sync-discard').onclick();assert.equal(b.cloud.pending,false);assert.equal(b.ctx.db.brands[0],'PC');
 loseResponse=true;next=structuredClone(b.ctx.db);next.brands.push('入荷');b.cloud.save(next);await settle();assert.equal(b.cloud.pending,true);assert.equal(server.revision,2);
 b.nodes.get('sync-retry').onclick();await settle();assert.equal(b.cloud.pending,false);assert.equal(server.revision,2);
 a.nodes.get('sync-refresh').onclick();await settle();assert.equal(a.ctx.db.brands.length,2);
 offline=true;next=structuredClone(a.ctx.db);next.brands.push('未送信');a.cloud.save(next);await settle();assert.equal(a.cloud.pending,true);assert.equal(server.payload.brands.length,2);assert.ok([...a.store.keys()].some(k=>k.includes('draft')));offline=false;
 a.nodes.get('sync-retry').onclick();await settle();assert.equal(a.cloud.pending,false);assert.equal(server.payload.brands.length,3);
 const other=browser('u2');await settle();assert.equal(other.ctx.db.brands.length,0);
 await a.nodes.get('sync-logout').onclick();assert.equal(a.nodes.get('main').hidden,true);assert.equal(a.store.has('stock-note-session:'+url),false);
 console.log('PASS: cloud save, competing clients, conflict recovery, lost-response retry without double write, refresh, offline draft, retry, account isolation UI and logout');
})().catch(e=>{console.error(e);process.exit(1)});
