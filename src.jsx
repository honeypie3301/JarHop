import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

import {limit, profiles, route} from './route.mjs';

const names={viltrumitecore:'Viltrumite Core',viltrumiteflight:'Viltrumite Flight',lasereyes:'Laser Eyes'};
const local=location.hostname==='127.0.0.1' && location.port==='4789';
const online=import.meta.env.VITE_JARHOP_ONLINE_URL;
const remote=!local && new URLSearchParams(location.search).get('runner')==='online';
async function request(url,options) {
  const response=await fetch(url,options);
  const body=await response.json();
  if(!response.ok) throw Error(body.error||response.statusText);
  return body;
}
function App() {
  const [files,setFiles]=useState([]),[job,setJob]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [runnerOffline,setRunnerOffline]=useState(false), [clock,setClock]=useState(Date.now());
  const [localProfiles,setLocalProfiles]=useState([]);
  const [account,setAccount]=useState(null),[cloud,setCloud]=useState(null);
  useEffect(()=>{
    if(remote) request('/api/online?action=session').then(setAccount).catch(()=>{});
    if(local) request('/api/local').then(data=>{setJob(data.jobs[0]);setLocalProfiles(data.profiles||[]);}).catch(e=>setError(e.message));
  },[]);
  useEffect(()=>{
    if(job?.status!=='running') return;
    let pending=false;
    const timer=setInterval(async()=>{
      setClock(Date.now());
      if(pending) return;
      pending=true;
      try {
        const current=await request('/api/local/'+job.id,{signal:AbortSignal.timeout(5000)});
        setJob(current);
        setRunnerOffline(false);
      } catch {
        setRunnerOffline(true);
      } finally { pending=false; }
    },1200);
    return ()=>clearInterval(timer);
  },[job?.id,job?.status]);
  useEffect(()=>{
    if(!cloud?.id || cloud.status==='completed') return;
    const timer=setInterval(()=>request('/api/online?action=status&id='+cloud.id).then(value=>setCloud({...value,id:cloud.id})).catch(e=>setError(e.message)),3500);
    return ()=>clearInterval(timer);
  },[cloud?.id,cloud?.status]);
  const picker=useRef(null), dependencyPicker=useRef(null);
  const [dragging,setDragging]=useState(false);
  const [mode,setMode]=useState(local?'upload':'prepared');
  const dynamic=mode==='upload';
  const [target,setTarget]=useState('26.1.2');
  const matched=new Set(files.map(file=>file.mod).filter(Boolean));
  const missing=Object.keys(profiles).filter(id=>!matched.has(id));
  const custom=localProfiles.find(profile=>profile.target===target &&
    files.length===profile.inputs.length && profile.inputs.every(input=>files.some(file=>file.hash===input.sha256)));
  const targets=[...new Set(['26.1.2','26.2',...localProfiles.map(profile=>profile.target)])];
  const checking=files.some(file=>file.checking);
  const blocked=busy || job?.status==='running' || (cloud && cloud.status!=='completed');
  const ready=!checking && (dynamic ? target==='26.1.2' && files.length>0 && files[0].role==='source' && files.every(file=>!file.issue&&(file.mod||file.inspection?.loader==='NeoForge')) : (Boolean(custom) || (target==='26.1.2' && !missing.length && files.length===3)));
  const hint=blocked?'A build is already running.':checking?'Checking JARs…':
    dynamic?(target!=='26.1.2'?'Upload builds currently target 26.1.2.':ready?'Ready to generate a project from the first JAR.':'Choose the NeoForge 1.21.1 source mod and add its dependencies if needed.'):
    custom?'Ready to build '+custom.title+'.':
    target!=='26.1.2'?'NeoForge '+target+' needs a migration profile before JarHop can build for it.':
    files.some(file=>!file.mod)?'This selection has no build profile for NeoForge '+target+'.':
    missing.length?'Add '+missing.map(id=>names[id]).join(', ')+'.':
    files.length!==3?'Keep one original JAR per mod.':'All three original JARs are ready.';
  function addFiles(list,role='source') {
    setError('');
    const added=Array.from(list, file=>({file,role,key:crypto.randomUUID(),checking:true}));
    if(dynamic&&role==='source') added.splice(1);
    setFiles(current=>dynamic&&role==='source'?[...added,...current.filter(item=>item.role==='dependency')]:[...current,...added]);
    for(const item of added) checkFile(item);
  }
  async function checkFile(item) {
    let issue,mod,inspection,hash;
    try {
      if(!item.file.name.toLowerCase().endsWith('.jar')) issue='Choose a .jar file.';
      else if(!item.file.size) issue='JAR is empty.';
      else if(remote&&item.file.size>limit) issue='Hosted uploads support up to 24 MiB per JAR.';
      else {
        const bytes=await crypto.subtle.digest('SHA-256',await item.file.arrayBuffer());
        hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
        mod=Object.keys(profiles).find(id=>profiles[id][1]===hash);
        if(!mod && local) {
          const data=new FormData();
          data.set('jar',item.file);
          inspection=await request('/api/local/inspect',{method:'POST',body:data});
        }
      }
    } catch(error) { issue=error.message || 'Could not read this file. Remove it and try again.'; }
    setFiles(current=>current.map(file=>file.key===item.key?{...file,mod,issue,inspection,hash,checking:false}:file));
  }
  async function submit(event) {
    event.preventDefault();
    if(!ready || blocked) return;
    setError('');setBusy(true);
    try {
      if(remote) {
        const {upload}=await import('@vercel/blob/client');
        const session=await request('/api/online?action=session');
        for (const [index,{file}] of files.entries()) {
          await upload('jobs/'+session.user+'/'+session.id+'/'+index+'.jar',file,{access:'private',
            contentType:'application/octet-stream',handleUploadUrl:'/api/online?action=upload'});
        }
        setCloud({...await request('/api/online?action=dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:session.id,route})}),status:'queued'});
        return;
      }
      const data=new FormData();
      data.set('route',dynamic?'upload-neoforge-26.1.2':custom?.id||route);
      for(const {file} of files) data.append('jar',file);
      setJob(await request('/api/local',{method:'POST',body:data}));
    } catch(e) {setError(e.message);}
    finally {setBusy(false);}
  }
  const canBuild=local||account;
  return <>
    <header className="bar"><div className="shell masthead">
      <div className="wordmark"><img className="mark" src={import.meta.env.BASE_URL+"jarhop.svg"} width="34" height="34" alt=""/>JarHop</div>
      <span className="runner"><span aria-hidden="true"/> {local?'Local runner':'Hosted workspace'}</span>
    </div></header>
    <main className="shell">
      <div className="intro">
        <h1>Port Minecraft mods.</h1>
        <p>Generate a NeoForge project directly from your mod JAR.</p>
      </div>
      {canBuild?<form className="panel" onSubmit={submit}>
                {local&&<fieldset className="targets"><legend className="mono">BUILD MODE</legend>
          <button type="button" aria-pressed={dynamic} onClick={()=>setMode('upload')}>From uploaded JAR</button>
          <button type="button" aria-pressed={!dynamic} onClick={()=>setMode('prepared')}>Prepared project</button>
        </fieldset>}
        <div className="panel-head"><h2>Mod JARs</h2><span className="mono">{files.length} selected</span></div>
        <input hidden ref={picker} type="file" accept=".jar" multiple={!dynamic} onChange={e=>{addFiles(e.target.files);e.target.value='';}}/>
        <button className={'drop'+(dragging?' dragging':'')} type="button" onClick={()=>picker.current.click()}
          onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
          onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}>
          <span className="upload" aria-hidden="true">↑</span>
          <strong>{dynamic?'Drop the source mod JAR here or browse':'Drop JARs here or browse'}</strong>
          <span>{dynamic?'NeoForge 1.21.1 source mod':'Original mod JARs'}</span>
        </button>
        {dynamic&&<div className="dependency-picker">
          <input hidden ref={dependencyPicker} type="file" accept=".jar" multiple onChange={e=>{addFiles(e.target.files,'dependency');e.target.value='';}}/>
          <button className="secondary" type="button" onClick={()=>dependencyPicker.current.click()}>Add dependency JARs</button>
          <p className="hint">Choose NeoForge JARs compatible with Minecraft 26.1.2.</p>
        </div>}
        {files.length>0&&<ul className="files">{files.map(item=><li key={item.key}>
          <div><strong>{item.file.name}</strong>{dynamic&&<small>{item.role==='dependency'?'Dependency':'Source mod'}</small>}<small className={item.issue?'invalid':''}>{item.issue||(item.checking?'Checking…':item.mod?names[item.mod]+' '+profiles[item.mod][0]:item.inspection?item.inspection.loader+' · '+item.inspection.classes+' classes'+(localProfiles.some(profile=>profile.inputs.some(input=>input.sha256===item.hash))?' · Local profile available':''):'Build profile unavailable')}</small></div>
          <button className="remove" type="button" aria-label={'Remove '+item.file.name} onClick={()=>setFiles(current=>current.filter(file=>file.key!==item.key))}>×</button>
        </li>)}</ul>}
        <div className="build-row">
                    <fieldset className="targets">
            <legend className="mono">TARGET · NEOFORGE</legend>
            {targets.map(version=><button type="button" key={version}
              aria-pressed={target===version} onClick={()=>setTarget(version)}>{version}{version!=='26.1.2'&&!localProfiles.some(profile=>profile.target===version)?' · No profile':''}</button>)}
          </fieldset>
          <button className="primary" aria-describedby="build-status" disabled={!ready||Boolean(blocked)}>Build port <span aria-hidden="true">↗</span></button>
        </div>
        <p className="hint" id="build-status" role="status">{hint}</p>
      </form>:<section className="panel">
        <h2>Open JarHop</h2>
        <p>Run <code>start.bat</code>, then open <a href="http://127.0.0.1:4789">the local app</a>.</p>
        {remote?<a href="/api/online?action=login">Sign in with GitHub</a>:<a href={(online||'/')+'?runner=online'}>Online jobs</a>}
      </section>}
      {cloud&&<p className="panel">GitHub Actions · {cloud.conclusion||cloud.status} {cloud.url&&<a href={cloud.url}>Run log and downloads ↗</a>}</p>}
      {error&&<p className="panel invalid" role="alert">{error}</p>}
      {job&&<section className="panel results">
        <div className="panel-head"><h2>{job.result?'Build exports':job.stage}</h2><span className="mono">{runnerOffline&&job.status==='running'?'RUNNER OFFLINE':job.status.toUpperCase()}</span></div>
        {job.inputs?.length>0&&<p className="job-inputs">{job.inputs.map(input=>names[input.id]||input.id).join(' · ')}</p>}
        {job.error&&<p className="invalid" role="alert">{job.error}</p>}
        {runnerOffline&&job.status==='running'&&<p className="invalid" role="status">Connection to the local runner was lost. Start JarHop again to recover the recorded job status.</p>}
        {!runnerOffline&&job.status==='running'&&job.lastOutputAt&&clock-job.lastOutputAt>=15000&&
          <p className="hint" role="status">Runner connected. No build output for {Math.floor((clock-job.lastOutputAt)/1000)} seconds.</p>}
        {job.status==='running'&&<button className="secondary" disabled={runnerOffline} onClick={()=>request('/api/local/'+job.id+'/cancel',{method:'POST'}).catch(e=>setError(e.message))}>Cancel build</button>}
        {job.result&&<><p>{job.result.tests?.serverStartup==='passed'?'Packaged JAR passed server startup. Client and gameplay checks are pending.':'Candidate build. Runtime checks are pending.'} {job.result.outputs.reduce((n,o)=>n+(o.changedAssets?.length||0),0)} resource paths differ from the inputs. See the manifest for details.</p><ul className="downloads">
          {['jarhop-candidate.zip',...job.result.outputs.map(o=>o.filename),'manifest.json'].map(name=><li key={name}><a href={'/api/local/'+job.id+'/'+name}>{name}<span aria-hidden="true">↓</span></a></li>)}
        </ul></>}
        {job.project&&<p><a href={'/api/local/'+job.id+'/migration-project.zip'}>Download editable project</a> · <a href={'/api/local/'+job.id+'/migration.log'}>Full migration log</a></p>}
        {job.serverVerificationLog&&<p><a href={'/api/local/'+job.id+'/server-verification.log'}>Server verification log</a></p>}
        <details key={job.id} open={job.status==='running'||undefined}><summary>Build log</summary><pre>{job.logs}</pre></details>
      </section>}
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);