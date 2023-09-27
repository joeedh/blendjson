import './util.js';
import './sdna.js';
import {BlendReader} from './blendfile.js';
import './config.js';
import {normpath} from './pathutil.js';
import fs from 'fs';

export function readBlendFile(path) {
  path = normpath(path);

  console.log("Reading blendfile", path);

  let buf = fs.readFileSync(path);
  let dview = new DataView(buf.buffer);

  let reader = new BlendReader(path, dview);
  reader.read();

  return reader.bfile;
}
