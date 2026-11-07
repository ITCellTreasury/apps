
/* Account drawer, profile editor and appearance preferences */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const drawer=$('profileDrawer'), topAvatar=$('avatar'), drawerAvatar=$('drawerAvatar');
 if(!drawer||!topAvatar||!drawerAvatar||typeof MailboxAPI==='undefined')return;
 const initials=(name,email)=>{
   const source=String(name||email||'U').trim();
   const parts=source.includes('@')?[source.split('@')[0]]:source.split(/\s+/).filter(Boolean);
   return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:source.slice(0,2)).toUpperCase();
 };
 const storedUser=()=>MailboxAPI.user()||{};
 const imageUrl=u=>String(u.profileImageUrl||u.Profile_Image_URL||'').trim();
 const paintAvatar=(u)=>{
   const label=initials(u.name||u.fullName,u.email||u.emailAddress);
   const src=imageUrl(u);
   [topAvatar,drawerAvatar].forEach(el=>{
     el.textContent=src?'':label;
     el.style.backgroundImage=src?'url("'+src.replace(/["\\\n\r]/g,'')+'")':'';
     el.classList.toggle('has-photo',!!src);
   });
   topAvatar.setAttribute('aria-label','Open account details for '+(u.name||u.email||'user'));
 };
 const updateLocalUser=u=>{
   const current=storedUser();
   const merged=Object.assign({},current,u);
   localStorage.setItem('mailbox_user',JSON.stringify(merged));
   sessionStorage.setItem('mailbox_user',JSON.stringify(merged));
   return merged;
 };
 const displayValue=value=>String(value||'').trim()||'—';
 const showProfileEditor=editing=>{
   $('profileDetails').hidden=!!editing;
   $('profileForm').hidden=!editing;
   $('editProfileBtn').hidden=!!editing;
 };
 const fillForm=u=>{
   const name=u.name||u.fullName||u.Full_Name||'';
   const recovery=u.recoveryEmail||u.Recovery_Email||'';
   const mobile=u.mobile||u.Mobile||'';
   const designation=u.designation||u.Designation||'';
   const department=u.department||u.Department||'';
   $('drawerName').textContent=name||'User';
   $('drawerEmail').textContent=u.email||u.emailAddress||u.Email_Address||'';
   $('profileFullName').value=name;
   $('profileRecoveryEmail').value=recovery;
   $('profileMobile').value=mobile;
   $('profileDesignation').value=designation;
   $('profileDepartment').value=department;
   $('detailFullName').textContent=displayValue(name);
   $('detailRecoveryEmail').textContent=displayValue(recovery);
   $('detailMobile').textContent=displayValue(mobile);
   $('detailDesignation').textContent=displayValue(designation);
   $('detailDepartment').textContent=displayValue(department);
   paintAvatar(u);
   showProfileEditor(false);
 };
 let currentProfile=storedUser(), imageBusy=false;
 fillForm(currentProfile);
 const openDrawer=async()=>{
   drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');topAvatar.setAttribute('aria-expanded','true');
   $('profileStatus').textContent='Loading account details…';
   try{
     const result=await MailboxAPI.request('getProfile',{token:MailboxAPI.token()});
     currentProfile=updateLocalUser(result.user||{});fillForm(currentProfile);
     $('profileStatus').textContent='';
   }catch(err){$('profileStatus').textContent=err.message||'Could not load profile details.';}
 };
 const closeDrawer=()=>{drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');topAvatar.setAttribute('aria-expanded','false')};
 topAvatar.addEventListener('click',openDrawer);
 $('editProfileBtn').addEventListener('click',()=>showProfileEditor(true));
 $('closeProfile').addEventListener('click',closeDrawer);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawer.classList.contains('open'))closeDrawer()});
 $('profileForm').addEventListener('submit',async e=>{
   e.preventDefault();
   const btn=$('saveProfileBtn'),status=$('profileStatus');
   const payload={
     fullName:$('profileFullName').value.trim(),
     recoveryEmail:$('profileRecoveryEmail').value.trim(),
     mobile:$('profileMobile').value.trim(),
     designation:$('profileDesignation').value.trim(),
     department:$('profileDepartment').value.trim()
   };
   if(!payload.fullName){status.textContent='Full name is required.';return;}
   btn.disabled=true;btn.classList.add('is-loading');status.textContent='Saving profile…';
   try{
     const result=await MailboxAPI.request('updateProfile',Object.assign({token:MailboxAPI.token()},payload));
     currentProfile=updateLocalUser(result.user||payload);
     fillForm(currentProfile);status.textContent='Profile updated successfully.';
   }catch(err){status.textContent=err.message||'Profile could not be saved.';}
   finally{btn.disabled=false;btn.classList.remove('is-loading')}
 });
 const fileInput=$('profileImageInput');
 $('changeAvatarBtn').addEventListener('click',()=>fileInput.click());
 fileInput.addEventListener('change',async()=>{
   const file=fileInput.files&&fileInput.files[0];if(!file)return;
   if(!file.type.startsWith('image/')){$('profileStatus').textContent='Please choose an image file.';fileInput.value='';return;}
   if(imageBusy)return;imageBusy=true;
   const status=$('profileStatus');status.textContent='Preparing profile photo…';
   try{
     const dataUrl=await new Promise((resolve,reject)=>{
       const url=URL.createObjectURL(file),img=new Image();
       img.onload=()=>{
         try{
           const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
           const ctx=canvas.getContext('2d');
           const side=Math.min(img.naturalWidth,img.naturalHeight);
           const sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;
           ctx.fillStyle='#ffffff';ctx.fillRect(0,0,64,64);
           ctx.drawImage(img,sx,sy,side,side,0,0,64,64);
           URL.revokeObjectURL(url);resolve(canvas.toDataURL('image/jpeg',0.86));
         }catch(err){URL.revokeObjectURL(url);reject(err)}
       };
       img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('The selected image could not be opened.'))};img.src=url;
     });
     status.textContent='Uploading profile photo…';
     const result=await MailboxAPI.request('updateProfile',{
       token:MailboxAPI.token(),imageDataUrl:dataUrl
     });
     currentProfile=updateLocalUser(result.user||{});fillForm(currentProfile);
     status.textContent='Profile photo updated.';
   }catch(err){status.textContent=err.message||'Profile photo could not be saved.';}
   finally{imageBusy=false;fileInput.value='';}
 });
 const applyTheme=c=>{
   if(!/^#[0-9a-f]{6}$/i.test(String(c||'')))return;
   document.documentElement.style.setProperty('--mailbox-accent',c);
   document.documentElement.style.setProperty('--primary',c);
   document.documentElement.style.setProperty('--accent',c);
   document.querySelectorAll('[data-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.theme.toLowerCase()===c.toLowerCase()));
 };
 applyTheme(localStorage.getItem('mailbox_theme_color')||'#2563eb');
 document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{const c=b.dataset.theme;applyTheme(c);localStorage.setItem('mailbox_theme_color',c)}));
 const setMode=mode=>{
   const valid=['light','dark'].includes(mode)?mode:'system';
   if(valid==='system')document.documentElement.removeAttribute('data-theme-mode');
   else document.documentElement.setAttribute('data-theme-mode',valid);
   localStorage.setItem('mailbox_theme_mode',valid);
   const dark=valid==='dark'||(valid==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
   const toggle=$('themeModeToggle');toggle.setAttribute('aria-pressed',String(dark));
   toggle.innerHTML=dark?'<i class="bi bi-sun"></i><span>Light mode</span><span class="theme-switch-track"><span></span></span>':'<i class="bi bi-moon-stars"></i><span>Dark mode</span><span class="theme-switch-track"><span></span></span>';
 };
 setMode(localStorage.getItem('mailbox_theme_mode')||'system');
 $('themeModeToggle').addEventListener('click',()=>setMode(document.documentElement.getAttribute('data-theme-mode')==='dark'?'light':'dark'));
})();
