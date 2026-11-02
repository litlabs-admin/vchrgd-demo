// Actual application modules, isolated environment, synthetic data by default.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function createLoader({mocks={}, env={}, fetchMock, database=false}={}) {
  const cache=new Map(), state={};
  const context=vm.createContext({Buffer,Request,Response,URL,URLSearchParams,FormData,TextEncoder,Uint8Array,Date,Intl,
    console:{warn(){},info(){},log(){},error(){}}, process:{env:{NODE_ENV:'test',APP_DATA_STORE:'memory',ADMIN_SESSION_SECRET:'synthetic-remediation-only',...env}},
    globalThis:state, fetch:fetchMock||(()=>{throw Error('External network forbidden');})});
  const load=spec=>{
    if(Object.hasOwn(mocks,spec))return mocks[spec];
    if(spec==='next/server')return {NextResponse:{json:Response.json,redirect:(url,status=307)=>new Response(null,{status,headers:{location:String(url)}})},after(){}};
    if(spec==='postgres')return database?require('postgres'):()=>{throw Error('Database forbidden in offline suite');};
    if(!spec.startsWith('@/')){
      if(spec.startsWith('node:'))return require(spec);
      throw Error('Unexpected dependency: '+spec);
    }
    if(cache.has(spec))return cache.get(spec).exports;
    const file=path.join(root,'src',spec.slice(2))+'.ts',module={exports:{}};cache.set(spec,module);
    const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInContext('(function(require,module,exports){'+source+'\n})',context,{filename:file})(load,module,module.exports);
    return module.exports;
  };
  load.close=async()=>{if(state.__vchrgdSupabaseSql)await state.__vchrgdSupabaseSql.end({timeout:5});};
  return load;
}
module.exports={createLoader};
