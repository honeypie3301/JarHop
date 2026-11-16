import {handleUpload} from '@vercel/blob/client';
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const route='neoforge-1.21.1-to-26.1.2';
const maxSize=24*1024*1024;
const env=process.env;
const sign=value=>createHmac('sha256',env.JARHOP_SESSION_SECRET).update(value).digest('hex');
const seal=value=>value+'.'+sign(value);
function unseal(value='') {
  const index=value.lastIndexOf('.');
  if(index<0) return '';
  const text=value.slice(0,index), given=Buffer.from(value.slice(index+1)), expected=Buffer.from(sign(text));
  return given.length===expected.length && timingSafeEqual(given,expected) ? text : '';
}
const cookie=(req,key)=>req.headers.cookie?.split('; ').find(item=>item.startsWith(key+'='))?.slice(key.length+1);
const setCookie=(res,key,value)=>res.setHeader('Set-Cookie',key+'='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600');
const allowed=user=>env.JARHOP_OPERATORS.split(',').some(entry=>entry.trim().toLowerCase()===user.toLowerCase());
async function github(endpoint,token,options={}) {
  return fetch('https://api.github.com/'+endpoint,{...options,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'}});
}
export default async function handler(req,res) {
  try {
    for(const name of ['JARHOP_SESSION_SECRET','JARHOP_OPERATORS','JARHOP_ORIGIN','JARHOP_WORKER_REPO','JARHOP_WORKER_TOKEN','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET']) {
      if(!env[name]) return res.status(503).json({error:'Online mode is not configured.'});
    }
    const action=req.query.action;
    if(action==='login') {
      const state=randomBytes(24).toString('hex');
      setCookie(res,'jh-state',seal(state));
      const query=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,state,redirect_uri:env.JARHOP_ORIGIN+'/api/online?action=callback'});
      return res.redirect('https://github.com/login/oauth/authorize?'+query);
    }
    if(action==='callback') {
      if(!req.query.state || req.query.state!==unseal(cookie(req,'jh-state'))) return res.status(403).json({error:'Invalid login state.'});
      const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:req.query.code,redirect_uri:env.JARHOP_ORIGIN+'/api/online?action=callback'})});
      const {access_token}=await exchange.json();
      if(!access_token) return res.status(403).json({error:'GitHub login failed.'});
      const identity=await github('user',access_token);
      const {login}=await identity.json();
      if(!login || !allowed(login)) return res.status(403).json({error:'Account is outside the operator allowlist.'});
      setCookie(res,'jh-session',seal(login+':'+(Date.now()+3600000)));
      return res.redirect('/?runner=online');
    }
    const [user,expiry]=unseal(cookie(req,'jh-session')).split(':');
    if(!user || Date.now()>=Number(expiry) || !allowed(user)) return res.status(401).json({error:'Sign in with an allowed GitHub account.'});
    if(req.method==='POST' && req.headers.origin!==env.JARHOP_ORIGIN) return res.status(403).json({error:'Invalid request origin.'});
    if(action==='session' && req.method==='GET') return res.json({user,id:randomUUID()});
    if(action==='upload' && req.method==='POST') {
      const result=await handleUpload({body:req.body,request:req,onBeforeGenerateToken:async pathname=>{
        if(!new RegExp('^jobs/'+user+'/[a-f0-9-]{36}/[0-2]\\.jar$','i').test(pathname)) throw Error('Invalid upload path.');
        return {allowedContentTypes:['application/java-archive','application/octet-stream','application/x-java-archive'],
          maximumSizeInBytes:maxSize,addRandomSuffix:false,allowOverwrite:false};
      },onUploadCompleted:async()=>{}});
      return res.json(result);
    }
    const repo='repos/'+env.JARHOP_WORKER_REPO+'/actions';
    if(action==='dispatch' && req.method==='POST') {
      const id=req.body.id;
      if(typeof id!=='string' || !/^[a-f0-9-]{36}$/.test(id) || req.body.route!==route) return res.status(400).json({error:'Invalid job.'});
      const response=await github(repo+'/workflows/port.yml/dispatches',env.JARHOP_WORKER_TOKEN,{method:'POST',body:JSON.stringify({
        ref:env.JARHOP_WORKER_REF||'main',inputs:{job:id,operator:user}
      })});
      if(!response.ok) throw Error('GitHub Actions rejected the job.');
      return res.status(202).json({id});
    }
    if(action==='status' && req.method==='GET' && /^[a-f0-9-]{36}$/.test(req.query.id)) {
      const response=await github(repo+'/workflows/port.yml/runs?event=workflow_dispatch&per_page=100',env.JARHOP_WORKER_TOKEN);
      if(!response.ok) throw Error('GitHub Actions status is unavailable.');
      const runs=(await response.json()).workflow_runs;
      const run=runs.find(item=>item.display_title===`JarHop ${user} ${req.query.id}`);
      if(!run) return res.json({status:'queued'});
      return res.json({status:run.status,conclusion:run.conclusion,url:run.html_url});
    }
    return res.status(404).json({error:'Unknown operation.'});
  } catch(error) { return res.status(400).json({error:error.message}); }
}
