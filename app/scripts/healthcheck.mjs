const base=process.env.CLOUDHERON_HEALTH_URL||'http://127.0.0.1:8800';
try {
  const r=await fetch(new URL('/api/ready',base),{signal:AbortSignal.timeout(5000)});
  const result=await r.json();
  if(!r.ok||result.status!=='ready')throw Error('服务尚未就绪：HTTP '+r.status);
  console.log('CloudHeron ready '+result.version);
} catch(error){console.error('CloudHeron health check failed: '+error.message);process.exitCode=1;}
