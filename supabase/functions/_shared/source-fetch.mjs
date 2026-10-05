export async function fetchSourceText(url, options={}, {timeoutMs=10000, fetchImpl=fetch}={}) {
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(new Error(`Source request exceeded ${timeoutMs} ms`));
    },timeoutMs);
  });
  try {
    return await Promise.race([deadline,(async()=>{
      const response=await fetchImpl(url,{...options,signal:controller.signal});
      if(!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      return await response.text();
    })()]);
  } finally { clearTimeout(timer); }
}
