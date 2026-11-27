(function (root) {
    'use strict';
    var module, next = 1, pending = {};
    function timeout(id) { return setTimeout(function () { module.postMessage({type:'abort',id:id}); finish(id,'Время ожидания истекло'); },45000); }
    function bytes(text) {
        var s = unescape(encodeURIComponent(text)), out = new Uint8Array(s.length), i;
        for (i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out.buffer;
    }
    function decode(chunks) {
        if (typeof TextDecoder === 'function') {
            var total = 0, i, offset = 0, merged;
            for (i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
            merged = new Uint8Array(total);
            for (i = 0; i < chunks.length; i++) { merged.set(new Uint8Array(chunks[i]), offset); offset += chunks[i].byteLength; }
            return new TextDecoder('utf-8', {fatal: true}).decode(merged);
        }
        var pieces = [], j, a;
        for (i = 0; i < chunks.length; i++) {
            a = new Uint8Array(chunks[i]);
            for (j = 0; j < a.length; j += 8192) pieces.push(String.fromCharCode.apply(null, a.subarray(j, j + 8192)));
        }
        return decodeURIComponent(escape(pieces.join('')));
    }
    function finish(id, error, hasBody) {
        var p = pending[id], text;
        if (!p) return;
        delete pending[id]; clearTimeout(p.timer);
        if (!error || (hasBody && !p.binary)) {
            try {
                if(p.binary){var out=new Uint8Array(p.size),offset=0;p.chunks.forEach(function(chunk){out.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;});text=out.buffer;}
                else text = decode(p.chunks);
            } catch (e) { if (!error) error = 'Неверная кодировка ответа'; }
        }
        if(root.DebugLog && (error || p.phase!=='api'||p.retried))root.DebugLog.record('network',{state:p.phase,http:p.status,ok:!error,endpoint:p.endpoint,retries:p.retried});
        p.callback(error, text, p.status, p.headers);
    }
    root.NativeNet = {
        attach: function (element) { module = element; },
        request: function (url, options, callback) {
            options = options || {};
            var a = document.createElement('a'), id = next++, headers = '', name, timer, optHeaders = options.headers || {};
            a.href = url;
            if (a.protocol !== 'https:') { callback('Нужен HTTPS'); return; }
            for (name in optHeaders) if (optHeaders.hasOwnProperty(name)) headers += name + ': ' + optHeaders[name] + '\r\n';
            timer = timeout(id);
            var request = {type:'request', id:id, host:a.hostname, port:443, path:(a.pathname.charAt(0) === '/' ? '' : '/') + a.pathname + a.search,
                method:options.method || 'GET', headers:headers, mode:root.playerSettings.tls, body:bytes(options.body || '')};
            if(options.freshConnection)request.freshConnection=true;
            pending[id] = {callback:callback, chunks:[], size:0, status:0, headers:'',binary:!!options.binary,timer:timer,request:request,retried:0,phase:a.pathname.indexOf('/api/stats/playback')===0?'playback':a.pathname.indexOf('/api/stats/watchtime')===0?'watchtime':'api'};
            pending[id].endpoint=(/\/youtubei\/v1\/(player|search|browse|next)(?:\/|$)/.exec(a.pathname)||[])[1]||(a.hostname==='suggestqueries.google.com'?'suggest':a.hostname==='www.youtube.com'&&a.pathname==='/'?'bootstrap':a.pathname.indexOf('/s/player/')===0?'script':pending[id].phase);
            module.postMessage(request);
        },
        receive: function (m) {
            var p = pending[m.id];
            if (!p) return;
            if (m.type === 'headers') {p.status = m.status;p.headers=m.headers||'';}
            if (m.type === 'data') {
                p.size += m.body.byteLength;
                if (p.size > 8 * 1024 * 1024) { module.postMessage({type:'abort', id:m.id}); finish(m.id, 'Ответ слишком большой'); }
                else p.chunks.push(m.body);
            }
            if (m.type === 'done') finish(m.id, p.status >= 200 && p.status < 300 ? null : 'HTTP ' + p.status, true);
            if (m.type === 'error') {
                if(root.DebugLog){var technical=String(m.error||''),number=/:\s*(-?\d+)/.exec(technical);root.DebugLog.record('network',{state:/^DNS/.test(technical)?'dns':/^TCP/.test(technical)?'tcp':/^timeout/.test(technical)?'timeout':/SSL|TLS|X509/.test(technical)?'tls':'transport',code:number?Number(number[1]):0,http:p.status,inputBytes:p.size,retries:p.retried,endpoint:p.endpoint,stage:m.stage,reused:m.reused,offset:m.sent});}
                // Search and player metadata are read-only POSTs. Retry a dropped read
                // before any HTTP response, without replaying mutation POSTs.
                var readOnlyPostFailed = p.request.host === 'www.youtube.com' &&
                    (p.endpoint === 'player' || p.endpoint === 'search') &&
                    p.request.method === 'POST' && m.error === 'TCP read: -2';
                var retryLimit = readOnlyPostFailed && m.stage === 'tls' && m.sent === 0 ? (p.endpoint === 'search' ? 4 : 2) : 1;
                if ((m.retryable || readOnlyPostFailed) && p.retried < retryLimit && !p.status && !p.size) {
                    delete pending[m.id]; clearTimeout(p.timer); var id=next++;
                    p.retried++;p.request.id=id;p.request.freshConnection=true;pending[id]=p;
                    p.timer=setTimeout(function(){p.timer=timeout(id);module.postMessage(p.request);},[300,900,1500,2500][p.retried-1]);
                } else finish(m.id, 'Ошибка сети: ' + (m.error || 'TLS'));
            }
        }
    };
}(this));
