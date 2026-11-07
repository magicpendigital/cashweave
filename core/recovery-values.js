// Archival encoding for corrupt structured-clone values; never activatable.
export async function recoveryGraph(value){
  const seen=new Map(),nodes=[];
  async function visit(item){
    if(item===null||typeof item==='string'||typeof item==='boolean')return {value:item};
    if(typeof item==='number')return {number:Number.isNaN(item)?'NaN':item===Infinity?'Infinity':item===-Infinity?'-Infinity':Object.is(item,-0)?'-0':String(item)};
    if(typeof item==='undefined')return {undefined:true};if(typeof item==='bigint')return {bigint:String(item)};
    if(seen.has(item))return {ref:seen.get(item)};const index=nodes.length;seen.set(item,index);nodes.push(null);let node;
    const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
    if(item instanceof Date)node={type:'Date',time:Number.isNaN(item.getTime())?'NaN':String(item.getTime())};
    else if(item instanceof RegExp)node={type:'RegExp',source:item.source,flags:item.flags,lastIndex:item.lastIndex};
    else if(item instanceof ArrayBuffer)node={type:'ArrayBuffer',hex:hex(new Uint8Array(item))};
    else if(ArrayBuffer.isView(item))node={type:item.constructor.name,buffer:await visit(item.buffer),byteOffset:item.byteOffset,byteLength:item.byteLength,...(typeof item.length==='number'?{length:item.length}:{})};
    else if(typeof Blob!=='undefined'&&item instanceof Blob)node={type:typeof File!=='undefined'&&item instanceof File?'File':'Blob',mime:item.type,name:typeof item.name==='string'?item.name:null,lastModified:typeof item.lastModified==='number'?item.lastModified:null,hex:hex(new Uint8Array(await item.arrayBuffer()))};
    else if(item instanceof Map){const entries=[];for(const [key,value]of item)entries.push([await visit(key),await visit(value)]);node={type:'Map',entries};}
    else if(item instanceof Set){const values=[];for(const value of item)values.push(await visit(value));node={type:'Set',values};}
    else if(item instanceof Error)node={type:'Error',name:item.name,message:item.message,stack:item.stack||'',cause:await visit(item.cause)};
    else{const entries=[];for(const key of Object.keys(item))entries.push([key,await visit(item[key])]);node={type:Array.isArray(item)?'Array':'Object',...(Array.isArray(item)?{length:item.length}:{}),entries};}
    nodes[index]=node;return {ref:index};
  }
  return {encoding:'cash-weave-structured-clone-graph-v1',root:await visit(value),nodes};
}
export function plainJson(value,seen=new Set()){
  if(value===null||['string','boolean'].includes(typeof value))return true;if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0);if(typeof value!=='object'||seen.has(value))return false;
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
  seen.add(value);if(Array.isArray(value)&&Object.keys(value).length!==value.length)return false;for(const key of Object.keys(value))if(!plainJson(value[key],seen))return false;seen.delete(value);return true;
}
