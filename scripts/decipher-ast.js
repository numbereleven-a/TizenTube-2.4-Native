// EJS emits arrow adapters around the legacy player's functions.
// Convert those adapters to function expressions before Astring prints them.
function legacyAdapters(node) {
    if (!node || typeof node !== 'object') return;
    Object.keys(node).forEach(function (key) {
        var value=node[key];
        if(Array.isArray(value))value.forEach(legacyAdapters);
        else if(value && typeof value==='object')legacyAdapters(value);
    });
    if(node.type==='ArrowFunctionExpression') {
        node.type='FunctionExpression';node.id=null;node.expression=false;
        if(node.body.type!=='BlockStatement')node.body={type:'BlockStatement',body:[{type:'ReturnStatement',argument:node.body}]};
    }
    if(node.type==='Property')node.shorthand=false;
}
var decipherPhase=1;
function decipherFunction(){
    decipherPhase=4;
    var fn=Function.apply(null,arguments);
    return function(){decipherPhase=5;var result=fn.apply(this,arguments);decipherPhase=1;return result;};
}
var meriyah={parse:function(source){decipherPhase=2;var tree=lib.meriyah.parse(source);decipherPhase=1;return tree;}},astring={generate:function(tree){decipherPhase=3;legacyAdapters(tree);var source=lib.astring.generate(tree);decipherPhase=1;return source;}};
