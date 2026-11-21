var decipherKey = '', decipherFunctions = null;
// Use the 15 safe bits of each storage character instead of wasting a UTF-16
// character on every ASCII byte of the public program. No surrogate units.
function packDecipher(source){
    var data=unescape(encodeURIComponent(source)),buffer=0,bits=0,chunk='',out=[];
    if(data.length>8388608)return null;
    for(var i=0;i<data.length;i++){buffer=(buffer<<8)|data.charCodeAt(i);bits+=8;if(bits>=15){bits-=15;chunk+=String.fromCharCode(256+((buffer>>>bits)&32767));buffer&=(1<<bits)-1;if(chunk.length===4096){out.push(chunk);chunk='';}}}
    if(bits)chunk+=String.fromCharCode(256+(buffer<<(15-bits)));out.push(chunk);return {source:out.join(''),size:data.length};
}
function unpackDecipher(cache){
    if(typeof cache.size!=='number'||cache.size<1||cache.size>8388608||typeof cache.source!=='string'||cache.source.length!==Math.ceil(cache.size*8/15))throw new Error('Invalid prepared program');
    var buffer=0,bits=0,chunk='',out=[],count=0;
    for(var i=0;i<cache.source.length;i++){var n=cache.source.charCodeAt(i)-256;if(n<0||n>32767)throw new Error('Invalid prepared program');buffer=(buffer<<15)|n;bits+=15;
        while(bits>=8&&count<cache.size){bits-=8;chunk+=String.fromCharCode((buffer>>>bits)&255);count++;if(chunk.length===4096){out.push(chunk);chunk='';}}
        buffer&=(1<<bits)-1;
    }
    out.push(chunk);if(count!==cache.size)throw new Error('Incomplete prepared program');return decodeURIComponent(escape(out.join('')));
}
function compileDecipher(source){var functions={n:null,sig:null};Function('_result',source)(functions);if(typeof functions.n!=='function')throw new Error('Missing transform');return functions;}
self.onmessage = function (event) {
    var request = event.data, phase=1,prepared='';
    try {
        if (request.key !== decipherKey) {
            var functions=null;
            if(request.prepared){try{functions=compileDecipher(unpackDecipher(request.prepared));}catch(e){}}
            if(!functions){
                var result = jsc({type:'player',player:request.player,output_preprocessed:true,requests:[{type:'n',challenges:['playerprobe0000']}]});
                phase=2;
                if (!result.preprocessed_player || result.responses[0].type !== 'result') throw new Error(result.responses[0].error||'Extraction failed');
                phase=3;prepared=result.preprocessed_player;functions=compileDecipher(prepared);
            }
            decipherFunctions = functions; decipherKey = request.key;
        }
        phase=4;
        var values = request.challenges.map(function (challenge) {
            var value = decipherFunctions.n(challenge);
            if (typeof value !== 'string' || !value) throw new Error('Invalid transform result');
            return value;
        });
        var cached=null;try{if(prepared)cached=packDecipher(prepared);}catch(ignore){}
        self.postMessage({id:request.id,ok:true,values:values,prepared:cached,sourceBytes:prepared.length});
    } catch (error) {
        var message=String(error && error.message || error),kind=/stack|recursion/i.test(message)?1:/not defined/i.test(message)?2:/not a function/i.test(message)?3:/Unexpected|syntax/i.test(message)?4:/no solutions/i.test(message)?5:/Cannot read|undefined|null/i.test(message)?6:/iterable|iterator/i.test(message)?7:/regular expression|Invalid.*flag/i.test(message)?8:/memory|allocation|array length/i.test(message)?9:0;
        var name=['Error','EvalError','RangeError','ReferenceError','SyntaxError','TypeError','URIError'].indexOf(error && error.name)+1;
        var missing=/Can't find variable: ([A-Za-z_$][A-Za-z0-9_$]{0,31})/.exec(message),property=/evaluating '([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+)/.exec(message);
        self.postMessage({id:request.id,ok:false,code:(phase===1?decipherPhase:phase)*100+name*10+kind,inputBytes:request.player.length,state:missing?'missing-'+missing[1].toLowerCase().replace(/[^a-z]/g,''):property?'property-'+property[1].toLowerCase().replace(/[^a-z]/g,''):''});
    }
};
