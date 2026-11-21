(function(root){
    'use strict';
    var host,input,hooks,rows=[],row=1,column=0,language='ru';
    function focus(r,c){row=r;column=Math.max(0,Math.min(rows[r].length-1,c));rows[row][column].focus();}
    function change(value){input.value=value;var event=document.createEvent('Event');event.initEvent('input',true,true);input.dispatchEvent(event);}
    function render(){
        host.textContent='';rows=[];
        var letters=language==='ru'?['1234567890','йцукенгшщзхъ','фывапролджэ','ячсмитьбюё']:['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];
        function addRow(keys){var line=document.createElement('div'),buttons=[];line.className='keyboard-row';
            keys.forEach(function(key){var button=document.createElement('button');button.type='button';button.textContent=key.label;button.onclick=key.action;line.appendChild(button);buttons.push(button);});host.appendChild(line);rows.push(buttons);
        }
        letters.forEach(function(line){addRow(line.split('').map(function(letter){return {label:letter,action:function(){change(input.value+letter);}};}));});
        addRow([
            {label:language==='ru'?'English':'Русский',action:function(){language=language==='ru'?'en':'ru';render();focus(4,0);}},
            {label:language==='ru'?'Пробел':'Space',action:function(){change(input.value+' ');}},
            {label:language==='ru'?'Удалить':'Delete',action:function(){change(input.value.slice(0,-1));}},
            {label:language==='ru'?'Очистить':'Clear',action:function(){change('');}},
            {label:language==='ru'?'Найти':'Search',action:function(){hide();hooks.submit();}}
        ]);
    }
    function show(){host.hidden=false;focus(row,column);}
    function hide(){if(host)host.hidden=true;}
    root.SearchKeyboard={
        mount:function(callbacks){hooks=callbacks;host=document.getElementById('search-keyboard');input=document.getElementById('query');input.readOnly=true;language=root.playerSettings.language==='en'?'en':'ru';render();input.addEventListener('focus',show);input.onclick=show;},
        hide:hide,
        key:function(key){
            if(!host||host.hidden)return false;
            var selected=document.activeElement,r=-1,c=-1;
            for(var i=0;i<rows.length;i++){var at=rows[i].indexOf(selected);if(at>=0){r=i;c=at;break;}}
            if(r<0)return false;
            if(key===13)selected.click();
            else if(key===37||key===39)focus(r,c+(key===37?-1:1));
            else if(key===38){if(r===0){hide();hooks.leave();}else focus(r-1,c);}
            else if(key===40)focus(Math.min(rows.length-1,r+1),c);
            else if(key===10009||key===27){hide();hooks.leave();}
            else return false;
            return true;
        }
    };
}(this));
