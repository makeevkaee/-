(() => {
  const $ = id => document.getElementById(id);
  let supabase = null, videos = [], selectedFile = null, previewUrl = null;
  let cameraStream = null, recorder = null, recordedChunks = [], facing = "user";
  let activeFilter = "none", activeMask = "", currentIndex = 0, currentUser = "Creator";
  const config = window.CLIPWAVE_CONFIG || {};
  const toast = msg => { const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); };
  const escapeHtml = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const initSupabase = (url,key) => {
    if (!url || !key || !window.supabase) { supabase=null; return false; }
    try { supabase=window.supabase.createClient(url,key); return true; } catch(e) { console.error(e); return false; }
  };
  initSupabase(config.supabaseUrl,config.supabaseAnonKey);
  const savedUrl=localStorage.getItem("cw_url"), savedKey=localStorage.getItem("cw_key");
  if(savedUrl&&savedKey) initSupabase(savedUrl,savedKey);
  $("supabaseUrl").value=savedUrl||config.supabaseUrl||"";
  $("supabaseKey").value=savedKey||config.supabaseAnonKey||"";

  function showView(name){
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    const view=$(name+"View"); if(view)view.classList.add("active");
    document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    if(name==="explore") renderGrid("videoGrid",videos);
    if(name==="profile") renderProfile();
    if(name==="feed") showCurrent();
  }
  document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
  $("searchOpen").onclick=()=>showView("explore"); $("profileOpen").onclick=()=>showView("profile");
  $("searchBtn").onclick=()=>{const q=$("searchInput").value.toLowerCase();renderGrid("videoGrid",videos.filter(v=>(v.description+" "+v.tags).toLowerCase().includes(q)));};
  $("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("searchBtn").click();});
  $("saveConfig").onclick=()=>{const u=$("supabaseUrl").value.trim(),k=$("supabaseKey").value.trim();if(!u||!k){$("configStatus").textContent="Заполни оба поля.";return;}localStorage.setItem("cw_url",u);localStorage.setItem("cw_key",k);$("configStatus").textContent=initSupabase(u,k)?"Подключение сохранено. Загружаю ленту…":"Не удалось создать клиент Supabase.";if(supabase)loadRemote();};
  $("videoFile").onchange=e=>{const f=e.target.files[0];if(!f)return;if(!f.type.startsWith("video/")){toast("Выбери видеофайл.");return;}setSelectedFile(f);};
  function setSelectedFile(file){selectedFile=file;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);const p=$("uploadPreview");p.innerHTML=`<video src="${previewUrl}" controls playsinline></video>`;$("publishBtn").disabled=false;$("uploadStatus").textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB`;}
  document.querySelectorAll(".filter-chip").forEach(b=>b.onclick=()=>{document.querySelectorAll(".filter-chip").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");activeFilter=b.dataset.filter;$("uploadPreview").style.filter=activeFilter;$("cameraVideo").style.filter=activeFilter;});
  document.querySelectorAll(".mask-chip").forEach(b=>b.onclick=()=>{document.querySelectorAll(".mask-chip").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");activeMask=b.dataset.mask;$("cameraMask").textContent=activeMask;});
  $("openCamera").onclick=async()=>{try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:true});$("cameraVideo").srcObject=cameraStream;$("cameraModal").hidden=false;$("recordBtn").disabled=false;}catch(e){toast("Не удалось открыть камеру. Проверь разрешение и HTTPS.");}};
  $("closeCamera").onclick=closeCamera;
  function closeCamera(){if(recorder&&recorder.state==="recording")recorder.stop();if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;$("cameraModal").hidden=true;}
  $("switchCamera").onclick=async()=>{facing=facing==="user"?"environment":"user";if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:true});$("cameraVideo").srcObject=cameraStream;}catch(e){toast("Эта камера недоступна.");}};
  function startRecording(){if(!cameraStream){toast("Сначала открой камеру.");return;}recordedChunks=[];const mime=MediaRecorder.isTypeSupported("video/webm;codecs=vp9")?"video/webm;codecs=vp9":"video/webm";recorder=new MediaRecorder(cameraStream,{mimeType:mime});recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data);};recorder.onstop=()=>{const blob=new Blob(recordedChunks,{type:"video/webm"});setSelectedFile(new File([blob],"clipwave-recording.webm",{type:"video/webm"}));$("cameraHint").textContent="Запись готова — можно закрыть камеру";$("recordBtn").disabled=false;$("recordBtn").textContent="● Начать запись";$("cameraRecord").style.background="#ff405b";};recorder.start();$("cameraHint").textContent="Идёт запись…";$("recordBtn").textContent="■ Остановить запись";$("recordBtn").disabled=false;$("cameraRecord").style.background="#fff";}
  $("recordBtn").onclick=()=>{if(recorder&&recorder.state==="recording")recorder.stop();else startRecording();};
  $("cameraRecord").onclick=()=>{if(recorder&&recorder.state==="recording")recorder.stop();else startRecording();};
  $("publishBtn").onclick=publish;
  async function publish(){
    if(!selectedFile)return;const description=$("videoDescription").value.trim(),tags=$("videoTags").value.trim(),author=$("creatorName").value.trim()||"Creator";
    $("publishBtn").disabled=true;$("uploadStatus").textContent="Публикую…";
    try{
      let item={id:"local-"+Date.now(),description,tags,author,likes:0,created_at:new Date().toISOString(),url:previewUrl,local:true};
      if(supabase){
        const path=`${Date.now()}-${Math.random().toString(36).slice(2)}-${selectedFile.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
        const {error:upErr}=await supabase.storage.from("videos").upload(path,selectedFile,{cacheControl:"3600",upsert:false,contentType:selectedFile.type});
        if(upErr)throw upErr;
        const {data:pub}=supabase.storage.from("videos").getPublicUrl(path);
        const {data,error}=await supabase.from("videos").insert({video_url:pub.publicUrl,storage_path:path,description,tags,author}).select().single();
        if(error)throw error;
        item={...data,url:data.video_url,likes:data.likes||0};
      }else{toast("Локальная публикация. Для общей ленты подключи Supabase.");}
      videos.unshift(item);currentIndex=0;showView("feed");showCurrent();renderGrid("videoGrid",videos);renderProfile();$("videoDescription").value="";$("videoTags").value="";$("videoFile").value="";selectedFile=null;$("publishBtn").disabled=true;$("uploadStatus").textContent="Опубликовано.";toast("Видео добавлено!");
    }catch(e){console.error(e);$("uploadStatus").textContent="Ошибка: "+(e.message||"не удалось загрузить");toast("Не удалось опубликовать. Проверь настройки Supabase.");}
    finally{$("publishBtn").disabled=!selectedFile;}
  }
  async function loadRemote(){
    if(!supabase)return;
    const {data,error}=await supabase.from("videos").select("*").order("created_at",{ascending:false}).limit(100);
    if(error){console.error(error);toast("Не удалось загрузить ленту. Проверь SQL и Storage.");return;}
    const remote=(data||[]).map(v=>({...v,url:v.video_url,likes:v.likes||0,local:false}));
    const locals=videos.filter(v=>v.local);videos=[...locals,...remote];currentIndex=0;showCurrent();renderGrid("videoGrid",videos);renderProfile();$("totalVideos").textContent=videos.length;
  }
  function showCurrent(){
    const v=videos[currentIndex];const video=$("feedVideo");
    if(!v){video.hidden=true;$("videoCaption").hidden=true;$("videoActions").hidden=true;$("emptyState").hidden=false;return;}
    $("emptyState").hidden=true;video.hidden=false;video.src=v.url;video.style.filter="none";video.play().catch(()=>{});
    $("videoCaption").hidden=false;$("videoActions").hidden=false;$("captionUser").textContent="@"+(v.author||"creator");$("captionText").textContent=v.description||"";$("captionTags").textContent=v.tags||"";$("likeCount").textContent=v.likes||0;$("likeBtn").dataset.id=v.id;$("totalVideos").textContent=videos.length;
  }
  $("likeBtn").onclick=async()=>{const v=videos[currentIndex];if(!v)return;v.likes=(v.likes||0)+1;$("likeCount").textContent=v.likes;if(supabase&&!v.local){const {error}=await supabase.from("videos").update({likes:v.likes}).eq("id",v.id);if(error)toast("Не удалось сохранить лайк.");}};
  $("commentBtn").onclick=()=>toast("Комментарии добавим в следующей версии.");
  $("shareBtn").onclick=async()=>{const v=videos[currentIndex];if(!v)return;try{await navigator.clipboard.writeText(location.href+"#video-"+v.id);toast("Ссылка скопирована.");}catch(e){toast("Скопируй адрес сайта из браузера.");}};
  function renderGrid(target,list){const el=$(target);el.innerHTML="";list.forEach((v,i)=>{const tile=document.createElement("div");tile.className="video-tile";tile.innerHTML=`<video src="${escapeHtml(v.url)}" muted playsinline preload="metadata"></video><span>${escapeHtml(v.description||"Без описания")}<br>@${escapeHtml(v.author||"creator")}</span>`;tile.onclick=()=>{currentIndex=videos.indexOf(v);showView("feed");};el.appendChild(tile);});}
  function renderProfile(){const name=$("creatorName").value.trim()||"Creator";$("profileName").textContent=name;$("profileHandle").textContent="@"+name.toLowerCase().replace(/\s+/g,"");$("profileAvatar").textContent=name[0].toUpperCase();const mine=videos.filter(v=>v.author===name);$("profileVideoCount").textContent=mine.length;$("profileLikes").textContent=mine.reduce((s,v)=>s+(v.likes||0),0);renderGrid("profileGrid",mine);}
  $("editProfile").onclick=()=>{const n=prompt("Как тебя называть?",$("profileName").textContent);if(n){$("creatorName").value=n;renderProfile();}};
  $("demoBtn").onclick=()=>{toast("Демо не встроено: добавь собственное видео через «Создать».");showView("upload");};
  if(supabase)loadRemote();
})();