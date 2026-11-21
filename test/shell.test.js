const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
    const nodes={},requests=[];
    const document={activeElement:null,createElement(tag){const n={tagName:tag.toUpperCase(),id:'',className:'',children:[],hidden:false,attrs:{},appendChild(c){c.parentNode=this;this.children.push(c);},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||null;},removeAttribute(k){delete this.attrs[k];},focus(){document.activeElement=this;},contains(c){return c===this||this.children.some(n=>n.contains(c));},getBoundingClientRect:()=>({top:0,bottom:100,left:200,right:300}),querySelectorAll(selector){let found=[];for(const c of this.children){if(selector==='.card'?c.className==='card':c.tagName===selector.toUpperCase())found.push(c);found.push(...c.querySelectorAll(selector));}return found;},querySelector(s){return this.querySelectorAll(s)[0]||null;}};Object.defineProperties(n,{textContent:{get(){return this.text;},set(v){this.text=v;this.children=[];}},firstChild:{get(){return this.children[0];}},lastChild:{get(){return this.children.at(-1);}}});return n;},getElementById(id){if(nodes[id])return nodes[id];for(const n of nodes['nav-items']?.children||[])if(n.id===id)return n;const n=this.createElement('div');n.id=id;return nodes[id]=n;}};
    document.documentElement={contains:n=>!!n.parentNode};
    const c={document,setTimeout:()=>1,clearTimeout(){},Auth:{signedIn:()=>true},YouTube:{account:(cb)=>cb(null,{name:'Synthetic'}),feed:(id,token,cb)=>requests.push({id,token,cb})},playerSettings:{recommendations:true}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('app/shell.js','utf8'),c);c.Shell.ready();requests.shift().cb(null,{items:[],shelves:[],continuation:''});
    return{c,nodes,requests,document,key:keyCode=>c.Shell.key({keyCode,preventDefault(){}})};
}
const items=(start,count)=>Array.from({length:count},(_,i)=>({id:'synthetic'+String(start+i).padStart(2,'0'),title:'Synthetic '+i,channel:'',duration:''}));
test('a short initial page fetches enough cards and flushes the final partial row',()=>{
    const s=setup();s.c.Shell.select('history');s.requests.shift().cb(null,{items:items(0,3),continuation:'next'});
    assert.equal(s.nodes.results.children.length,0);assert.equal(s.requests.length,1);assert.equal(s.nodes.more.hidden,true);
    s.requests.shift().cb(null,{items:items(3,3),continuation:''});assert.equal(s.nodes.results.children.length,6);assert.equal(s.document.activeElement,s.nodes.results.children[0]);assert.equal(s.nodes.more.hidden,true);
});
test('feeds buffer partial rows and prefetch before the end without stealing focus',()=>{
    const s=setup();s.c.Shell.select('subscriptions');s.requests.shift().cb(null,{items:items(0,15),continuation:'page-two'});
    assert.equal(s.nodes.results.children.length,12);assert.equal(s.nodes.more.hidden,true);
    s.key(40);assert.equal(s.requests.length,1);s.key(40);assert.equal(s.requests.length,1);const focus=s.document.activeElement;
    s.key(39);assert.equal(s.requests.length,1);const moved=s.document.activeElement;
    s.requests.shift().cb(null,{items:items(15,15),continuation:'page-three'});assert.equal(s.document.activeElement,moved);assert.equal(s.nodes.results.children.length,28);
    assert.equal(s.nodes.more.hidden,true);s.key(40);s.key(40);s.key(40);assert.equal(s.requests.length,1);s.requests.shift().cb('Temporary failure');assert.equal(s.nodes.empty.hidden,true);assert.equal(s.nodes.more.hidden,false);
    s.key(39);assert.equal(s.requests.length,0);s.nodes.more.onclick();assert.equal(s.requests.length,1);assert.equal(s.nodes.more.hidden,true);s.requests.shift().cb(null,{items:items(30,4),continuation:''});assert.equal(s.nodes.more.hidden,true);
    assert.equal(s.nodes.results.children.length,34);for(let i=0;i<34;i++)assert.match(s.nodes.results.children[i].querySelector('img').getAttribute('data-src'),new RegExp('synthetic'+String(i).padStart(2,'0')));
    assert.notEqual(s.document.activeElement,focus);
});
test('home rows and sections keep separate continuations and ignore detached responses',()=>{
    const s=setup();s.c.Shell.select('home',false,true);s.requests.shift().cb(null,{items:[],shelves:[{title:'First',items:items(0,5),continuation:'row-two'},{title:'Second',items:items(5,5)}],continuation:'section-two'});
    s.key(39);s.key(39);s.key(39);assert.equal(s.requests[0].token,'row-two');s.requests.shift().cb(null,{items:items(10,5),continuation:''});assert.equal(s.nodes.results.children[0].children[1].children.length,10);
    s.key(40);assert.equal(s.requests[0].token,'section-two');const before=s.document.activeElement;
    s.requests.shift().cb(null,{items:[],shelves:[{title:'Third',items:items(15,5),continuation:'row-three'}],continuation:''});assert.equal(s.nodes.results.children.length,3);assert.equal(s.document.activeElement,before);
    s.key(40);const pending=s.requests.shift();assert.equal(pending.token,'row-three');s.c.Shell.select('search');pending.cb(null,{items:items(20,5),continuation:''});assert.equal(s.nodes.results.children.length,0);
});
test('search button D-pad, paginated search and signed-in retry state behave cleanly',()=>{
    const s=setup();
    s.c.YouTube.searchPage=(query,token,cb)=>s.requests.push({id:'search:'+query,token,cb});
    s.c.Shell.select('search');
    s.document.getElementById('search').focus();assert.equal(s.key(37),true);assert.equal(s.document.activeElement,s.nodes.query);
    s.nodes.search.focus();assert.equal(s.key(39),true);assert.equal(s.document.activeElement,s.nodes['top-search']);
    s.nodes.search.focus();assert.equal(s.key(38),true);assert.equal(s.document.activeElement,s.nodes['top-search']);
    s.c.Shell.search('cats');const first=s.requests.shift();assert.equal(first.id,'search:cats');
    first.cb('Network failed');assert.equal(s.nodes.empty.hidden,false);assert.equal(s.nodes['empty-login'].hidden,false);
    s.nodes['empty-login'].onclick();const retried=s.requests.shift();assert.equal(retried.id,'search:cats');
    retried.cb(null,{items:items(0,15),continuation:'search-p2'});assert.equal(s.nodes.empty.hidden,true);assert.equal(s.nodes.results.children.length,12);
    s.key(40);const nextPage=s.requests.shift();assert.equal(nextPage.token,'search-p2');
});
