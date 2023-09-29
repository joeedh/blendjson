import * as util from './util.js';

export const config = {};
import {ConfigDef} from './config_parse.js';

export * from './config_parse.js';

export const configDef = new ConfigDef().from({
  "print" : ["bool", false, "Prints file tree"],
  "folder": ["bool", false, "Write tree to folder"],
});
