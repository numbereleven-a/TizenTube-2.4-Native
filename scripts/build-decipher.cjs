const fs=require('node:fs'),path=require('node:path'),babel=require('@babel/core'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),ejsRoot=process.argv[2];
if(!ejsRoot)throw Error('Usage: node scripts/build-decipher.cjs EJS_ROOT');
const lib=fs.readFileSync(path.join(ejsRoot,'lib.min.js'),'utf8'),core=fs.readFileSync(path.join(ejsRoot,'core.min.js'),'utf8');
// Keep the EJS-generated wrapper ES5 too; transpiling the library alone does
// not transform code constructed later from its template literal.
let templates=0,environments=0;
const legacyCore=babel.transformSync(core,{configFile:false,babelrc:false,plugins:[function({types:t}){return {visitor:{StringLiteral(p){
    if(!p.node.value.includes('globalThis.XMLHttpRequest')||!p.node.value.includes('globalThis.location'))return;
    // A Worker's own location is read-only. Keep EJS's browser mock local to
    // the extracted program instead of changing WorkerGlobalScope.
    environments++;
    p.node.value='var globalThis={},URL;\n'+p.node.value+'\nvar window=globalThis.window,self=globalThis.self,document=globalThis.document,navigator=globalThis.navigator,location=globalThis.location,XMLHttpRequest=globalThis.XMLHttpRequest;\n';
},CallExpression(p){if(t.isIdentifier(p.node.callee,{name:'Function'}))p.node.callee=t.identifier('decipherFunction');},TemplateLiteral(p){
    if(p.node.quasis.some(q=>q.value.raw.includes('({sig, n}) =>'))){
        if(p.node.expressions.length!==1)throw Error('Unexpected EJS URL adapter');
        templates++;
        const before='(function(input){var sig=input.sig,n=input.n,url=(',after=')("https://youtube.com/watch?v=yt-dlp-wins","s",sig?encodeURIComponent(sig):undefined);url.set("n",n);var proto=Object.getPrototypeOf(url),keys=Object.keys(proto).concat(Object.getOwnPropertyNames(proto));for(var i=0;i<keys.length;i++){var key=keys[i];if(["constructor","set","get","clone"].indexOf(key)<0){url[key]();break;}}var s=url.get("s"),out=url.get("n");return {sig:s?decodeURIComponent(s):null,n:out==null?null:out};})';
        p.node.quasis=[t.templateElement({raw:before,cooked:before},false),t.templateElement({raw:after,cooked:after},true)];return;
    }
    if(!p.node.quasis.some(q=>q.value.raw.includes('const _results = new Set()')))return;
    if(p.node.expressions.length!==1)throw Error('Unexpected EJS wrapper');
    templates++;
    p.node.quasis=[t.templateElement({raw:'(function(_input){var generators=',cooked:'(function(_input){var generators='},false),t.templateElement({raw:',results=[],errors=[];for(var i=0;i<generators.length;i++){try{var result=generators[i](_input);if(results.indexOf(result)<0)results.push(result);}catch(e){errors.push(e);}}if(!results.length)throw "no solutions";if(results.length!==1)throw "invalid solutions";return results[0];})',cooked:',results=[],errors=[];for(var i=0;i<generators.length;i++){try{var result=generators[i](_input);if(results.indexOf(result)<0)results.push(result);}catch(e){errors.push(e);}}if(!results.length)throw "no solutions";if(results.length!==1)throw "invalid solutions";return results[0];})'},true)];
}}};}]}).code;
if(templates!==2)throw Error('Expected the two EJS 0.8.0 wrappers');
if(environments!==1)throw Error('Expected the EJS 0.8.0 browser environment');
// The downloaded player also needs standard built-ins that Babel's static
// usage analysis cannot see. The old TV raised ReferenceError/TypeError in
// that code with usage-only polyfills (including MIN_SAFE_INTEGER.toString).
const source='require("core-js/es");\n'+lib+'\n'+fs.readFileSync(path.join(__dirname,'decipher-ast.js'),'utf8')+'\n'+legacyCore+'\n'+fs.readFileSync(path.join(__dirname,'decipher-worker.js'),'utf8');
const transformed=babel.transformSync(source,{sourceType:'script',configFile:false,babelrc:false,comments:false,presets:[[require.resolve('@babel/preset-env'),{targets:{ie:'11'},useBuiltIns:'usage',corejs:'3.47',modules:'commonjs'}]]}).code;
esbuild.buildSync({stdin:{contents:transformed,resolveDir:root,sourcefile:'decipher-worker.js'},outfile:path.join(root,'app/decipher-worker.js'),bundle:true,platform:'browser',format:'iife',target:'es5',minify:true,legalComments:'none',sourcemap:false});
const notices=lib.slice(lib.indexOf(' * Bundled Dependencies:')+3,lib.indexOf('*/')).replace(/^ \* ?/gm,'');
fs.writeFileSync(path.join(root,'native/assets/LICENSE-EJS-Dependencies.txt'),notices);
fs.copyFileSync(path.join(root,'node_modules/core-js/LICENSE'),path.join(root,'native/assets/LICENSE-CoreJS.txt'));
fs.copyFileSync(path.join(root,'node_modules/@babel/core/LICENSE'),path.join(root,'native/assets/LICENSE-Babel.txt'));
