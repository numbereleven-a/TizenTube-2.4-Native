(function (root) {
    'use strict';
    var saved = null, access = '', expires = 0, identity = null, polling = null, generation = 0, sessionGeneration = 0, refreshQueue = null;
    var ua = 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version';
    try { saved = JSON.parse(localStorage.getItem('omega-account') || 'null'); } catch (e) {}
    var accounts=[],activeKey='';
    try { accounts=JSON.parse(localStorage.getItem('omega-accounts')||'[]');activeKey=localStorage.getItem('omega-active-account')||''; } catch(e) { accounts=[]; }
    if(!Array.isArray(accounts))accounts=[];
    if(saved && saved.refresh && !accounts.some(function(a){return a.key===activeKey;})){
        activeKey='account-'+Date.now();accounts.push({key:activeKey,session:saved,name:'',handle:''});
    }
    function writeStorage(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (e) {
            try { localStorage.removeItem('omega-decipher'); localStorage.removeItem('ttl-diagnostics'); } catch (ignore) {}
            try { localStorage.setItem(key, value); return true; } catch (retryError) { return false; }
        }
    }
    function persistAccounts(){
        var ok = true;
        if(accounts.length) ok = writeStorage('omega-accounts', JSON.stringify(accounts)); else localStorage.removeItem('omega-accounts');
        if(activeKey) ok = writeStorage('omega-active-account', activeKey) && ok; else localStorage.removeItem('omega-active-account');
        if(!ok) throw Error('quota');
    }
    function changeSession(){
        cancel();sessionGeneration++;access='';expires=0;
        if(refreshQueue){var queue=refreshQueue;refreshQueue=null;queue.forEach(function(cb){cb('Аккаунт изменён');});}
    }
    function form(url, values, cb) {
        var body = Object.keys(values).map(function (key) { return encodeURIComponent(key)+'='+encodeURIComponent(values[key]); }).join('&');
        NativeNet.request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':ua},body:body},function (error,text,status) {
            var data; try { data=JSON.parse(text); } catch (e) { cb('Ошибка соединения с Google',null,status); return; }
            cb(error,data,status);
        });
    }
    function notify() { if (Auth.onchange) Auth.onchange(Auth.signedIn()); }
    function remember(data, client, added) {
        access = data.access_token; expires = Date.now()+Math.max(0,Number(data.expires_in)-60)*1000;
        if (data.refresh_token) saved = {refresh:data.refresh_token,id:client.id,secret:client.secret};
        if(added){activeKey='account-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);accounts.push({key:activeKey,session:saved,name:'',handle:''});}
        accounts.forEach(function(a){if(a.key===activeKey)a.session=saved;});
        if (saved) {
            if (!writeStorage('omega-account', JSON.stringify(saved)))
                return 'Вход выполнен, но телевизор не смог сохранить аккаунт';
        }
        try{persistAccounts();}catch(e){return 'Вход выполнен, но телевизор не смог сохранить аккаунт';}
        return null;
    }
    function getIdentity(cb) {
        if (identity) { cb(null,identity); return; }
        NativeNet.request('https://www.youtube.com/tv',{headers:{'User-Agent':ua}},function (error,html) {
            if (error) { cb('Не удалось получить параметры входа'); return; }
            var script=/<script[^>]*id="base-js"[^>]*src="([^"]+)/.exec(html)||/<script[^>]*src="([^"]+)"[^>]*id="base-js"/.exec(html);
            if (!script) { cb('YouTube изменил параметры входа'); return; }
            var url=script[1];
            if (url.indexOf('//')===0) url='https:'+url;
            else if (url.charAt(0)==='/') url='https://www.youtube.com'+url;
            // Read the public TV client's current device-flow identity locally.
            // It is not embedded in packages or sent to a developer service.
            if (!/^https:\/\/(www\.)?youtube\.com\//.test(url)) { cb('Неизвестный источник параметров входа'); return; }
            NativeNet.request(url,{headers:{'User-Agent':ua}},function (failed,bundle) {
                if (failed) { cb('Не удалось загрузить параметры входа'); return; }
                var match=/clientId:"([^"]+)",[^:]+:"([^"]+)"/.exec(bundle);
                if (!match) { cb('YouTube изменил параметры входа'); return; }
                identity={id:match[1],secret:match[2]}; cb(null,identity);
            });
        });
    }
    function cancel() { generation++; clearTimeout(polling); polling=null; }
    var Auth = root.Auth = {
        onchange:null,
        signedIn:function () { return !!(saved && saved.refresh || access); },
        cancel:cancel,
        reset:function(){changeSession();saved=null;accounts=[];activeKey='';['omega-account','omega-accounts','omega-active-account','omega-settings','omega-resume','omega-decipher','ttl-diagnostics'].forEach(function(key){localStorage.removeItem(key);});},
        accounts:function(){return accounts.map(function(a){return {key:a.key,name:a.name,handle:a.handle,active:a.key===activeKey};});},
        profile:function(value){accounts.forEach(function(a){if(a.key===activeKey){a.name=value.name||'';a.handle=value.handle||'';}});try{persistAccounts();}catch(e){}},
        select:function(key){var account=accounts.filter(function(a){return a.key===key;})[0];if(!account)return false;
            changeSession();activeKey=key;saved=account.session;
            try{localStorage.setItem('omega-account',JSON.stringify(saved));persistAccounts();}catch(e){}
            notify();return true;
        },
        signOut:function () {
            changeSession();accounts=accounts.filter(function(a){return a.key!==activeKey;});activeKey='';saved=null;
            try { localStorage.removeItem('omega-account'); } catch (e) {}
            try{persistAccounts();}catch(e){}
            notify();
        },
        token:function (cb) {
            if (access && Date.now()<expires) { cb(null,access); return; }
            if (!saved || !saved.refresh) { cb('Войдите в аккаунт'); return; }
            if (refreshQueue) { refreshQueue.push(cb); return; }
            refreshQueue=[cb]; var current=sessionGeneration, client={id:saved.id,secret:saved.secret};
            form('https://oauth2.googleapis.com/token',{grant_type:'refresh_token',refresh_token:saved.refresh,client_id:client.id,client_secret:client.secret},function(error,data,status){
                if(current!==sessionGeneration) return;
                var queue=refreshQueue;refreshQueue=null;
                if(status===200 && data && data.access_token){remember(data,client);queue.forEach(function(done){done(null,access);});}
                else { if(data && data.error==='invalid_grant'){Auth.signOut();}queue.forEach(function(done){done('Не удалось обновить вход в аккаунт');}); }
            });
        },
        start:function (cb) {
            cancel(); var current=generation;
            getIdentity(function(error,client){
                if(current!==generation)return;
                if(error){cb({kind:'error',message:error});return;}
                form('https://oauth2.googleapis.com/device/code',{client_id:client.id,scope:'https://www.googleapis.com/auth/youtube'},function(failed,data,status){
                    if(current!==generation)return;
                    if(status!==200 || !data || !data.device_code || !data.user_code){cb({kind:'error',message:'Google не выдал код входа. Попробуйте ещё раз.'});return;}
                    var end=Date.now()+Number(data.expires_in||1800)*1000, interval=Math.max(5,Number(data.interval||5));
                    var verify=data.verification_url||data.verification_uri||'https://www.google.com/device';
                    if(verify.indexOf('https://')!==0){cb({kind:'error',message:'Google вернул неизвестный адрес входа'});return;}
                    var complete=data.verification_url_complete||data.verification_uri_complete||verify+(verify.indexOf('?')<0?'?':'&')+'user_code='+encodeURIComponent(data.user_code);
                    cb({kind:'code',url:verify,complete:complete,userCode:data.user_code,expiresAt:end});
                    function schedule(){polling=setTimeout(poll,interval*1000);}
                    function poll(){
                        if(current!==generation)return;
                        if(Date.now()>=end){cb({kind:'error',message:'Код истёк. Получите новый код.'});return;}
                        form('https://oauth2.googleapis.com/token',{client_id:client.id,client_secret:client.secret,device_code:data.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'},function(err,reply,http){
                            if(current!==generation)return;
                            if(http===200 && reply && reply.access_token){changeSession();var warning=remember(reply,client,true);polling=null;cb({kind:'success',message:warning});notify();return;}
                            var reason=reply && reply.error;
                            if(reason==='slow_down')interval+=5;
                            if(!http || reason==='authorization_pending' || reason==='slow_down'){schedule();return;}
                            cb({kind:'error',message:reason==='access_denied'?'Вход отменён в Google':reason==='expired_token'?'Код истёк. Получите новый код.':'Не удалось выполнить вход. Получите новый код.'});
                        });
                    }
                    schedule();
                });
            });
        }
    };
}(this));
