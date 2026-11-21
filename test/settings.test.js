const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('settings navigate with the remote, persist categories and require confirmation before reset',()=>{
    const nodes={};let saved=0,resets=0,reloads=0;
    const document={activeElement:null,createElement(){const n={children:[],hidden:false,appendChild(c){this.children.push(c);c.parentNode=this;},focus(){document.activeElement=this;if(this.onfocus)this.onfocus();},contains(target){return this===target||this.children.some(c=>c.contains(target));}};Object.defineProperty(n,'textContent',{set(v){this.text=v;this.children=[];},get(){return this.text;}});return n;},getElementById(id){return nodes[id]||(nodes[id]=this.createElement());}};
    document.getElementById('home').hidden=false;document.getElementById('settings').hidden=false;
    const c={document,playerSettings:{autoplay:false,recommendations:true,language:'ru',sponsor:true,sponsorCategories:['sponsor'],sponsorMarkers:true,sponsorNotice:true},saveSettings(){saved++;return true;},Auth:{accounts:()=>[],signedIn:()=>false,reset(){resets++;}},location:{reload(){reloads++;}},DebugLog:{read:()=>[]}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('app/settings.js','utf8'),c);c.SettingsUI.mount();c.SettingsUI.open();
    const buttons=()=>nodes['settings-options'].children,click=part=>buttons().find(b=>b.textContent.includes(part)).onclick();
    c.SettingsUI.key(13);c.SettingsUI.key(40);c.SettingsUI.key(13);assert.ok(buttons()[2].textContent.startsWith('✓'));c.SettingsUI.key(40);c.SettingsUI.key(13);
    assert.equal(c.playerSettings.autoplay,true);assert.equal(saved,1);assert.equal(document.activeElement,buttons()[1]);
    document.getElementById('settings-button').focus();c.SettingsUI.key(27);assert.match(nodes['settings-heading'].textContent,/Воспроизведение/);c.SettingsUI.key(27);
    click('Настройки SponsorBlock');click('Заставки');assert.ok(c.playerSettings.sponsorCategories.includes('intro'));
    assert.match(document.activeElement.textContent,/Заставки/);c.SettingsUI.key(37);
    click('Сброс настроек');assert.equal(document.activeElement.textContent,'Отмена');assert.equal(resets,0);
    c.SettingsUI.key(27);assert.equal(resets,0);click('Сброс настроек');click('Подтвердить');
    assert.equal(resets,1);assert.equal(reloads,1);
});
test('English labels and messages translate while stream numbers remain unchanged',()=>{
    const c={localStorage:{getItem:()=>JSON.stringify({language:'en'})},document:{documentElement:{},body:{nodeType:0},getElementById:()=>null},MutationObserver:function(){this.observe=()=>{};}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('app/i18n.js','utf8'),c);
    assert.equal(c.I18n.text('Автовоспроизведение следующего видео · Отключено'),'Autoplay next video · Off');
    assert.equal(c.I18n.text('✓ Рекламные интеграции'),'✓ Sponsors');assert.equal(c.I18n.text('1080p60 · H.264'),'1080p60 · H.264');
    assert.equal(c.I18n.text('← → перемотка \u00a0 OK панель \u00a0 ↓ кнопки \u00a0 Назад к списку'),'← → seek \u00a0 OK controls \u00a0 ↓ buttons \u00a0 Back to list');
    assert.equal(c.I18n.text('← → перемотка \u00a0 ↑ переход \u00a0 OK панель \u00a0 ↓ кнопки \u00a0 Назад к списку'),'← → seek \u00a0 ↑ jump \u00a0 OK controls \u00a0 ↓ buttons \u00a0 Back to list');
    assert.equal(c.I18n.text('SponsorBlock: вкл.'),'SponsorBlock: on');
    assert.equal(c.I18n.text('SponsorBlock: выкл.'),'SponsorBlock: off');
});
