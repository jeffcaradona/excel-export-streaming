import debugLib from 'debug';

// Load package.json to get the module name
/*
import pkg from './package.json' with { type: 'json' }; 
     - happens once at module load, is synchronous, cached, 
        and avoids extra filesystem boilerplate. 
        Ideal for config constants like name, version, etc.

fs.promises.readFile (or readFileSync) 
     - makes sense when the JSON content changes at runtime, 
        you need to handle failures dynamically, or 
        you don’t want it bundled.
*/


import pkg from '../../package.json' with { type: 'json' };

const MODULE_NAME = pkg?.name ?? 'excel-export-streaming';


const createDebugger = (namespace) => debugLib(namespace);


const debugServer = createDebugger(`${MODULE_NAME}:server`);
const debugApplication = createDebugger(`${MODULE_NAME}:application`);
const debugAPI = createDebugger(`${MODULE_NAME}:api`);
const debugMSSQL = createDebugger(`${MODULE_NAME}:mssql`);


export { debugServer, debugApplication, debugAPI, debugMSSQL };
export default createDebugger;