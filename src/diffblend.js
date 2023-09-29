import * as util from './util.js';
import './sdna.js';
import {BlendReader, BlendWriter} from './blendfile.js';
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

export function writeBlendFile(bfile, path) {
  console.log("writing", path);

  let writer = new BlendWriter(bfile);
  writer.write();
  let buf = Buffer.from(writer.finish());

  console.log(util.readableSize(buf.byteLength));
  fs.writeFileSync(path, buf);
}

