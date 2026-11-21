const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('search keyboard keeps the digit row open and leaves only above it',()=>{
    const nodes={};let changes=0,left=0,submitted=0;
    const document={activeElement:null,createEvent:()=>({initEvent(){}}),createElement(){const n={children:[],events:{},appendChild(c){this.children.push(c);},focus(){document.activeElement=this;if(this.events.focus)this.events.focus();},addEventListener(k,cb){this.events[k]=cb;},dispatchEvent(){changes++;},click(){this.onclick();}};Object.defineProperty(n,'textContent',{get(){return this.text;},set(v){this.text=v;this.children=[];}});return n;},getElementById(id){return nodes[id]||(nodes[id]=this.createElement());}};
    const c={document,playerSettings:{language:'ru'}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/search-keyboard.js','utf8'),c);
    c.SearchKeyboard.mount({leave(){left++;},submit(){submitted++;}});nodes.query.value='';nodes.query.focus();
    const host=nodes['search-keyboard'];assert.equal(nodes.query.readOnly,true);assert.equal(document.activeElement.textContent,'й');
    c.SearchKeyboard.key(38);assert.equal(host.hidden,false);assert.equal(document.activeElement.textContent,'1');assert.equal(left,0);
    c.SearchKeyboard.key(13);assert.equal(nodes.query.value,'1');assert.equal(changes,1);
    c.SearchKeyboard.key(38);assert.equal(host.hidden,true);assert.equal(left,1);
    nodes.query.focus();assert.equal(host.hidden,false);c.SearchKeyboard.key(40);c.SearchKeyboard.key(13);assert.equal(nodes.query.value,'1й');
    const actions=host.children[4].children;actions[2].click();assert.equal(nodes.query.value,'1');actions[3].click();assert.equal(nodes.query.value,'');
    actions[0].click();assert.equal(document.activeElement.textContent,'Русский');c.SearchKeyboard.key(38);c.SearchKeyboard.key(13);assert.equal(nodes.query.value,'z');
    host.children[4].children[1].click();assert.equal(nodes.query.value,'z ');host.children[4].children[4].click();assert.equal(submitted,1);assert.equal(host.hidden,true);
});
