// Prints fresh secrets for .env. Run once per environment; never commit the output.
const c = require('node:crypto');
const k = () => c.randomBytes(32).toString('base64');
console.log(`DATA_KEY=${k()}\nDATA_KEY_ID=k1\nINDEX_KEY=${k()}\nTOKEN_KEY=${k()}`);
