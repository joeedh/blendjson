import {SDNAParser, SDNAType, SDNATypes} from './sdna.js';
import {BinReader, BinWriter, Endian} from './binfile.js';
import {eCustomDataType, eIDPropertyType, OrigBuffer} from './enums.js';
import * as util from './util.js';
import {readCustomDataLayer, structCustomDataLayer} from './customdata.js';
import fs from 'fs';
import zlib from 'zlib';
import pathmod from 'path';

let lastSDNA = undefined;

export class BlendReadError extends Error {}

const IS_WINDOWS = process.platform.startsWith("win");

export function JSONstringify(obj, param, indent) {
  let buf = JSON.stringify(obj, param, indent);

  if (IS_WINDOWS) {
    buf = buf.replace(/\n/g, "\r\n");
  }

  return buf;
}

import {ParentSym, StructSym, PointerSym} from './enums.js';
/* Print a warning on unknown pointers
 * (which are usually leftover runtime data).
 */
const DEBUG_UNKNOWN_POINTERS = false;

export class BHead {
  constructor(id, data, old, sdna, nr, len = -1) {
    this.id = id;
    this.data = data;
    this.old = old;
    this.sdna = sdna;
    this.nr = nr;
    this.len = len;
  }

  iterBlocks() {
    if (this.nr === 1) {
      return [this.data];
    } else {
      return this.data;
    }
  }
}

let nonblocks = new Set([
  "DATA", "ENDB", "REND", "GLOB", "DNA1", "TEST"
]);

export class BlendFile {
  constructor(name) {
    this.endian = Endian.LITTLE;
    this.name = name;
    this.bheads = [];
    this.oldmap = new Map();
    this.oldmap_bhead = new Map();
    this.sdna = undefined;
    this.main = {};
    this.version = 0;
  }

  writeBlendFolder(bname) {
    console.log("Writing out/" + bname);

    let blocks = this.beginWrite();
    let path = `out/${bname}`;
    let mkdir = (p) => fs.mkdirSync(p, {recursive: true});

    mkdir(path);
    /* Write render/glob data */
    for (let bh of this.bheads) {
      if (bh.id === "REND") {
        fs.writeFileSync(`${path}/rend.bin`, Buffer.from(bh.data));
      } else if (bh.id === "GLOB") {
        let data = this.writeStruct(bh.data, blocks);
        fs.writeFileSync(`${path}/glob`, JSONstringify(data, undefined, 1));
      } else if (bh.id === "TEST") {
        fs.writeFileSync(`${path}/test.bin`, Buffer.from(bh.data));
      }
    }

    let meta = {
      blendFileVersion: this.version,
      endian          : this.endian,
      sdna            : this.sdna.toJSON(),
    };

    fs.writeFileSync(`${path}/meta`, JSONstringify(meta, undefined, 1));

    let okmap = [];

    for (let i = "a".charCodeAt(0); i < "z".charCodeAt(0); i++) {
      okmap.push(String.fromCharCode(i));
    }
    for (let i = "A".charCodeAt(0); i < "Z".charCodeAt(0); i++) {
      okmap.push(String.fromCharCode(i));
    }
    okmap.push(".");
    okmap.push("_");
    okmap.push("~");
    okmap.push("?");
    okmap.push("<");
    okmap.push(">");
    okmap.push(" ");
    for (let i = 0; i <= 9; i++) {
      okmap.push(String.fromCharCode("0".charCodeAt(0) + i));
    }
    okmap = new Set(okmap);

    let safename = (s) => {
      let s2 = '';
      for (let i = 0; i < s.length; i++) {
        if (okmap.has(s[i])) {
          s2 += s[i];
          continue;
        }

        s2 += "x" + s.charCodeAt(i).toString(16);
      }

      return s2;
    }

    for (let k in this.main) {
      let list = this.main[k];
      for (let obj of list) {
        let name = obj.id.name;
        name = safename(name);

        let buf = this.writeStruct(obj, blocks);
        buf = JSONstringify(buf, undefined, 1);

        let outpath = `${path}/${k}/${name}`;
        console.log(outpath);

        mkdir(pathmod.dirname(outpath));
        fs.writeFileSync(outpath, buf);
      }
    }
  }

  printTree() {
    console.log("Printing blendfile tree");
    let file = this.makeTree();

    console.log("Writing out.json");
    fs.writeFileSync("out.json", JSONstringify(file, undefined, 1));
  }

  compressFile() {
    let sdna_nr = this.sdna.structs["CustomDataLayer"].nr;

    for (let bh of this.bheads) {
      if (bh.sdna !== sdna_nr) {
        continue;
      }

      for (let layer of bh.iterBlocks()) {
        if (!layer.data || layer.data.length === 0) {
          continue;
        }

        let buf = layer.data;
        if (!(buf instanceof ArrayBuffer)) {
          buf = buf[OrigBuffer];
        }

        let zbuf = zlib.deflateSync(buf, {level: 4});
        //console.log(zbuf.buffer.byteLength, buf.byteLength);

        let s = '';
        if (zbuf.byteLength < buf.byteLength) {
          s = "c";
          buf = zbuf;
        } else {
          s = 'u';
        }

        if (buf.byteLength > 512) {
          buf = new Buffer.from(buf);
          layer.data = "#comparray#" + buf.toString("base64");
        }
      }
    }
  }

  writeStruct(obj, blocks, visit = new Map(), visit_idgen = 1) {
    var writeType = (val, type, fname) => {
      switch (type.type) {
        case SDNATypes.INT:
        case SDNATypes.SHORT:
        case SDNATypes.CHAR:
        case SDNATypes.FLOAT:
        case SDNATypes.DOUBLE:
          return val;
        case SDNATypes.ARRAY:
          if (type.subtype.type === SDNATypes.CHAR && typeof val === "string") {
            return val;
          }

          let array = [];
          for (let i = 0; i < type.params; i++) {
            array.push(writeType(val[i], type.subtype, fname));
          }
          return array;
        case SDNATypes.STRUCT:
          return writeStruct(val, fname + `(${type.subtype.name})`);
        case SDNATypes.POINTER: {
          if (typeof val === "string" && val.startsWith("#comparray#")) {
            return val;
          }

          if (!val) {
            return null;
          }

          if (blocks.has(val)) {
            return blocks.get(val) + val.id.name;
          } else {
            if (val instanceof Array) {
              let id = getOrAssignID(val);
              if (id !== undefined) {
                return `#ref#${id}`;
              } else if (0) {
              } else {
                let type2 = type.subtype;

                if (val.length > 0 && type2.type === SDNATypes.VOID) {
                  if (fname.endsWith("(CustomDataLayer)->data")) {
                    /* Deal with simple number arrays*/
                    if (typeof val[0] === "number" || (typeof val[0] === "object" && typeof val[0][0] === "number")) {
                      return util.list(val);
                    }
                  }

                  if (typeof val[0] === "object" && val[0][StructSym]) {
                    type2 = {
                      type   : SDNATypes.STRUCT,
                      subtype: val[0][StructSym],
                    }
                  }
                }

                return util.list(val).map(f => writeType(f, type2, fname));
              }
            } else {
              return val ? writeType(val, type.subtype, fname) : null;
            }
          }
        }
      }
    };

    var writeIDProp = (obj, name) => {
      let idp = Object.assign({}, obj);
      delete idp[StructSym];
      delete idp[ParentSym];
      delete idp.next;
      delete idp.prev;

      for (let f of obj[StructSym]._fields) {
        if (f.name.startsWith("_pad")) {
          delete idp[f.name];
        }
      }

      idp.data = undefined;
      if (obj.ui_data) {
        idp.ui_data = writeStruct(obj.ui_data, obj.ui_data[StructSym]);
      }

      switch (obj.type) {
        case eIDPropertyType.IDP_INT:
        case eIDPropertyType.IDP_FLOAT:
        case eIDPropertyType.IDP_DOUBLE:
        case eIDPropertyType.IDP_BOOLEAN:
          idp.data = obj.data.val;
          break;
        case eIDPropertyType.IDP_ARRAY:
        case eIDPropertyType.IDP_STRING:
          idp.data = obj.data.pointer;
          break;
        case eIDPropertyType.IDP_IDPARRAY:
          idp.data = [];
          for (let idp2 of obj.data.pointer) {
            idp.data.push(writeIDProp(idp2));
          }
          break;
        case eIDPropertyType.IDP_GROUP:
          idp.data = [];

          for (let idp2 of obj.data.group) {
            idp.data.push(writeIDProp(idp2));
          }

          break;
      }

      return idp;
    };

    var getOrAssignID = (data) => {
      let id = visit.get(data);

      if (id === undefined) {
        visit.set(data, visit_idgen++);
      }

      return id;
    };

    var writeStruct = (obj, fname) => {
      let st = obj[StructSym];
      let ret = {};

      let id = getOrAssignID(obj);
      if (id !== undefined) {
        return `#ref#${id}`;
      }

      visit.set(obj, visit_idgen++);

      if (st.name === "IDProperty") {
        return writeIDProp(obj, fname);
      }

      if (fname === undefined) {
        fname = st.name;
      }

      for (let f of st._fields) {
        if (f.name.startsWith("_pad")) {
          continue;
        }

        let fpath;

        if (f.type.type === SDNATypes.POINTER) {
          fpath = fname + "->" + f.name;
        } else {
          fpath = fname + "." + f.name;
        }

        ret[f.name] = writeType(obj[f.name], f.type, fpath);
      }

      return ret;
    };

    return writeStruct(obj);
  }

  beginWrite() {
    let blocks = new Map();
    for (let k in this.main) {
      let list = this.main[k];
      for (let obj of list) {
        blocks.set(obj, k.toUpperCase());
      }
    }
    return blocks;
  }

  makeTree() {
    console.log("Printing blendfile tree");

    let file = {
      main: {}
    };

    let blocks = this.beginWrite();

    for (let k in this.main) {
      let list = this.main[k];
      let list2 = file.main[k] = [];

      for (let obj of list) {
        let st = obj[StructSym];

        list2.push(this.writeStruct(obj, blocks), st.name);
      }
    }

    return file;
  }
}

class BHeadWriteCtx {
  directDatas = new Map();
  w = null; /* BinWriter. */
  blocks = new Set();

  shallowCopy() {
    let ctx = new BHeadWriteCtx();
    ctx.directDatas = this.directDatas;
    ctx.w = this.w;
    ctx.blocks = this.blocks;

    return ctx;
  }
}

export class BlendWriter {
  constructor(bfile) {
    this.bfile = bfile;
    this.sdna = bfile.sdna;
    this.w = new BinWriter();

    this.ptrmap = new Map();
    this.ptrGen = 1;
  }

  write() {
    const w = this.w;
    const bfile = this.bfile;
    const sdna = this.sdna;

    w.chars("BLENDER");

    let etest = new Int32Array(1);
    let utest = new Uint8Array(etest.buffer);
    etest[0] = 1;

    const endian = utest[0] === 1 ? Endian.LITTLE : Endian.BIG;

    w.int8(0);
    w.char(endian === Endian.LITTLE ? "v" : "V");

    let version = bfile.version.toString();
    if (version.length !== 3) {
      throw new Error("Malformed version " + version);
    }

    w.chars(version);

    let bhSdna, bhRend, bhGlob, bhTest;
    let blocks = [];

    for (let bh of bfile.bheads) {
      if (bh.id === "DNA1") {
        bhSdna = bh;
      } else if (bh.id === "GLOB") {
        bhGlob = bh;
      } else if (bh.id === "REND") {
        bhRend = bh;
      } else if (bh.id === "TEST") {
        bhTest = bh;
      } else if (bh.id !== "DATA") {
        blocks.push(bh);
        console.log(bh.id);
      }
    }

    /* Note that we derive the "DATA" bheads. */
    blocks = new Set(blocks);

    /* Write global. */
    this.writeBHead(bhGlob);
    //XXX
    //this.writeBHead(bhTest);
    //this.writeBHead(bhRend);

    for (let block of blocks) {
      this.writeBHead(block);
    }

    /* Write sdna code. */
    console.log(bhSdna);
    this.writeBHead(bhSdna);

    let endb = new BHead("ENDB", null, 0, 0, 0);
    this.writeBHead(endb);
  }

  finish() {
    return this.w.finish();
  }

  getPtr(obj, type, ctx) {
    if (!obj) {
      return BigInt(0);
    }

    let ptr = this.ptrmap.get(obj);

    if (ptr === undefined) {
      ptr = this.ptrGen++;
      this.ptrmap.set(obj, ptr);

      if (type && ctx && !ctx.blocks.has(obj)) {
        ctx.directDatas.set(obj, type);
      }
    }

    return BigInt(ptr);
  }

  writeBHead(bh) {
    const w                           = this.w, sdna            = this.sdna,
          ptrmap = this.ptrmap, bfile = this.bfile;

    let len;

    let st = sdna.structlist[bh.sdna];

    if (bh.id === "TEST" || bh.id === "REND" || bh.id === "DNA1") {
      len = bh.data.byteLength;
    } else if (bh.id !== "ENDB") {
      len = st.calcSize()*bh.nr;
    } else {
      len = 0;
    }

    let id = bh.id;
    while (id.length < 4) {
      id += "\0";
    }
    w.chars(id);

    w.int32(len);
    w.uint64(this.getPtr(bh.data));
    w.int32(bh.sdna);
    w.int32(bh.data instanceof Array ? bh.data.length : 1);

    if (bh.type === "TEST" || bh.type === "REND" || bh.type === "DNA1") {
      w.buffer(bh.data);
      return;
    }

    if (bh.id === "ENDB") {
      return;
    }

    if (bh.data instanceof ArrayBuffer) {
      w.buffer(bh.data);
      return;
    }

    let blockset = new Set();
    for (let k in this.bfile.main) {
      for (let v of this.bfile.main[k]) {
        blockset.add(v);
      }
    }

    for (let data of bh.iterBlocks()) {
      let ctx = new BHeadWriteCtx();
      ctx.blocks = blockset;
      ctx.w = this.w;

      this.writeStruct(data, st, ctx);

      let i = 0;
      do {
        let directDatas = ctx.directDatas;
        ctx.directDatas = new Map();

        for (let [data, type] of directDatas) {
          this.writeDirectData(data, type, ctx);
        }

        if (i++ > 150) {
          console.error("Infinite loop error");
          break;
        }
      } while (ctx.directDatas.size > 0);
    }

    return w;
  }

  writeNull(type, ctx) {
    const w = ctx.w;

    switch (type.type & SDNATypes.TYPEMASK) {
      case SDNATypes.CHAR:
        w.int8(0);
        break;
      case SDNATypes.SHORT:
        w.int16(0);
        break;
      case SDNATypes.FLOAT:
      case SDNATypes.INT:
        w.int32(0);
        break;
      case SDNATypes.DOUBLE:
      case SDNATypes.INT64_T:
      case SDNATypes.POINTER:
        w.int64(BigInt(0));
        break;
      case SDNATypes.ARRAY:
        for (let i = 0; i < type.params; i++) {
          this.writeNull(type.subtype, ctx);
        }
        break;
      case SDNATypes.STRUCT: {
        const size = type.subtype.calcSize();
        for (let i = 0; i < size; i++) {
          w.int8(0);
        }
        break;
      }
      case SDNATypes.VOID:
        break; /* Do nothing. */

      default:
        throw new Error("unknown type " + type);
    }
  }

  writeType(val, type, ctx, parent, fpath = '') {
    const w = ctx.w;
    const sdna = this.sdna;

    const typemask = type.type & SDNATypes.TYPEMASK;
    const unsigned = type.type & SDNATypes.UNSIGNED;

    switch (typemask) {
      case SDNATypes.CHAR:
        unsigned ? w.uint8(val) : w.int8(val);
        break;
      case SDNATypes.SHORT:
        unsigned ? w.uint16(val) : w.int16(val);
        break;
      case SDNATypes.INT:
        unsigned ? w.uint32(val) : w.int32(val);
        break;
      case SDNATypes.INT64_T:
        unsigned ? w.uint64(BigInt(val)) : w.int64(BigInt(val));
        break;
      case SDNATypes.FLOAT:
        w.float32(val);
        break;
      case SDNATypes.DOUBLE:
        w.float64(val);
        break;
      case SDNATypes.POINTER:
        w.uint64(this.getPtr(val, type, ctx));

        break;
      case SDNATypes.ARRAY: {
        if ((type.subtype.type & SDNATypes.TYPEMASK) && typeof val === "string") {
          w.string(val, type.params);
          break;
        }

        if (!val) {
          console.log("No array data!", val, type, fpath, parent.constructor.name);

          throw new Error("array error");
        }
        for (let i = 0; i < type.params; i++) {
          this.writeType(val[i], type.subtype, ctx, val);
        }
        break;
      }
      case SDNATypes.STRUCT:
        this.writeStruct(val, type.subtype, ctx, fpath);
        break;
      case SDNATypes.VOID:
        break; /* Do nothing. */
      default:
        throw new Error("unknown type " + typemask);
    }
  }

  writeStruct(obj, st, ctx, fpath = st.name) {
    //XXX
    if (st.name === "IDProperty" || st.name === "IDPropertyData") {
      //return;
    }

    const is_cd_layer = st.name === "CustomDataLayer";

    for (let f of st._fields) {
      if (f.name.startsWith("_pad")) {
        this.writeNull(f.type, ctx);
        continue;
      }

      let val = obj[f.name];
      if (is_cd_layer && f.name === "data") {
        if (obj.type === eCustomDataType.CD_PROP_BOOL && val instanceof ArrayBuffer) {
          val = util.list(new Uint8Array(obj));

          val[StructSym] = this.sdna.structs["MBoolProperty"].nr;
          val[OrigBuffer] = obj.data;
        }

        val = structCustomDataLayer(val);
      }

      const dot = f.type !== SDNATypes.POINTER ? "." : "->";
      this.writeType(val, f.type, ctx, obj, fpath + dot + f.name);
    }
  }

  writeDirectData(obj, type, ctx) {
    ctx = ctx.shallowCopy();

    let st;
    let sdna_nr = 0;
    let nr = 1;
    let old;

    const w = ctx.w = new BinWriter();
    let buffered = false;
    let bufLength = 0;

    let finish = () => {
      let data = w.finish();

      let sdna_name = sdna_nr > 0 ? this.sdna.structlist[sdna_nr].name : "0";

      if (data.byteLength === 0) {
        console.log(sdna_name, "DATA", data, type);
      }

      if (nr === undefined) {
        console.log("-=-=-=-=>>>", obj._sanitize(), type, nr, sdna_name);
        throw new Error("nr was undefined");
      }

      /* Write bhead header. */
      this.w.chars("DATA");
      this.w.int32(data.byteLength);
      this.w.uint64(this.getPtr(obj));
      this.w.int32(sdna_nr);
      this.w.int32(nr);

      this.w.buffer(data);
    }

    if (ArrayBuffer.isView(obj)) {
      w.buffer(obj.buffer);
      buffered = true;
      bufLength = obj.byteLength;
    } else if (obj instanceof ArrayBuffer) {
      w.buffer(obj);
      buffered = true;
      bufLength = obj.length;
    }

    if (buffered) {
      if ((type.type & SDNATypes.TYPEMASK) === SDNATypes.STRUCT) {
        throw new Error("Typed array error.");

        sdna_nr = type.subtype.nr;
        nr = bufLength/type.subtype.calcSize();
      }

      console.log("___Buffered!___");
      finish();
      return;
    }

    const basictypes = new Set([
      SDNATypes.INT, SDNATypes.SHORT, SDNATypes.CHAR, SDNATypes.INT64_T, SDNATypes.FLOAT,
      SDNATypes.DOUBLE,
    ]);

    const typemask = type.type & SDNATypes.TYPEMASK;
    if (typemask === SDNATypes.STRUCT) {
      sdna_nr = type.subtype.nr;

      if (!obj[StructSym]) {
        throw new Error("no struct info");
      }

      this.writeStruct(obj, obj[StructSym], ctx);
    } else if (typemask === SDNATypes.POINTER) {
      nr = obj instanceof Array ? obj.length : 1;

      let typemask2 = type.subtype.type & SDNATypes.TYPEMASK;

      if (typemask2 === SDNATypes.POINTER) {
        for (let i = 0; i < obj.length; i++) {
          w.uint64(this.getPtr(obj[i], type.subtype, ctx));
        }
      } else {
        let st;

        if (typemask2 === SDNATypes.VOID) {
          st = obj[StructSym];
        } else if (typemask2 === SDNATypes.STRUCT) {
          st = obj[StructSym] ?? type.subtype.subtype;
        } else {
          throw new Error("invalid type " + typemask2);
        }

        if (st === undefined) {
          console.log("obj:", obj);
          throw new Error("missing sdna struct");
        }

        sdna_nr = st.nr;

        if (obj instanceof Array) {
          for (let i = 0; i < obj.length; i++) {
            this.writeStruct(obj[i], st, ctx);
          }
        } else {
          this.writeStruct(obj, st, ctx);
        }
      }
    } else if (typemask === SDNATypes.VOID) {
      nr = obj instanceof Array ? obj.length : 1;

      for (let i = 0; i < obj.length; i++) {
        w.uint64(this.getPtr(obj[i], obj[StructSym], ctx));
      }
    } else if (basictypes.has(typemask)) {
      nr = obj instanceof Array ? obj.length : 1;

      let static_array = {
        type   : SDNATypes.ARRAY,
        subtype: {
          type: type.type /* Make sure we include unsigned flag. */
        },

        params: obj.length
      }

      this.writeType(obj, static_array, ctx);
    } else {
      throw new Error("unknown type " + typemask);
    }

    finish();
  }
}

export class BlendReader {
  constructor(name, dview) {
    this.bfile = new BlendFile(name);
    this.r = new BinReader(dview);
  }

  read() {
    let r = this.r;
    let header = r.string(7);

    if (header !== "BLENDER") {
      throw new BlendReadError("Invalid blendfile");
    }

    let endian = r.skip(1).string(1);

    if (endian !== "v") {
      r.endian = Endian.BIG;
    }

    this.bfile.endian = r.endian;

    console.log(header);
    console.log(endian);
    let version = this.bfile.version = parseInt(r.string(3));

    while (!r.eof()) {
      let id = r.string(4);
      let len = r.int32();
      let old = r.uint64();
      let sdna = r.int32();
      let nr = r.int32();

      let data = r.bytes(len);
      let bhead = new BHead(id, data, old, sdna, nr, len);

      if (bhead.id === "ENDB") {
        break;
      } else {
        this.bfile.bheads.push(bhead);
      }
    }

    let sdna;

    for (let bhead of this.bfile.bheads) {
      let st = bhead.sdna;
      if (lastSDNA) {
        st = lastSDNA.structlist[st];
        st = st ? st.name : bhead.sdna;
      }

      console.log("=", bhead.id, st, bhead.nr, bhead.len);
      if (bhead.id === "DNA1") {
        sdna = bhead.data;
      }
    }

    if (!sdna) {
      throw new BlendReadError("Failed to find blendfile sdna data");
    }

    let parser = new SDNAParser();
    sdna = this.bfile.sdna = parser.parse(sdna, r.endian, 8);
    lastSDNA = sdna;

    for (let bhead of this.bfile.bheads) {
      this.readBHead(bhead);
    }

    this.link();
  }

  readBHead(bh) {
    //console.log("Reading bhead", bh.id, bh.old);

    let st;

    if (bh.id === "REND") {
      //Ignore
      return;
    } else if (bh.sdna === 0) {
      /* Derive type later from owning objects. */
      this.bfile.oldmap.set(bh.old, bh.data);
      this.bfile.oldmap_bhead.set(bh.old, bh);

      return;
    } else {
      st = this.bfile.sdna.structlist[bh.sdna];
    }

    const origbuffer = bh.data;
    const r = new BinReader(bh.data);

    r.endian = this.r.endian;

    bh.data = [];
    bh.data[OrigBuffer] = origbuffer;
    bh.data[StructSym] = st;

    for (let i = 0; i < bh.nr; i++) {
      let data = this.readStruct(r, st);
      data[OrigBuffer] = origbuffer;
      data[StructSym] = st;

      bh.data.push(data);
    }

    if (bh.data.length === 1) {
      bh.data = bh.data[0];
    }

    this.bfile.oldmap.set(bh.old, bh.data);
    this.bfile.oldmap_bhead.set(bh.old, bh);
  }

  readStruct(r, st) {
    function readArray(type) {
      let val = [];

      for (let i = 0; i < type.params; i++) {
        val.push(readValue(type.subtype));
      }

      return val;
    }

    function readValue(type) {
      let value;

      let typemask = type.type;

      let t = typemask & SDNATypes.TYPEMASK;
      let unsigned = typemask & SDNATypes.UNSIGNED;

      if (t === SDNATypes.POINTER) {
        unsigned = true;
      }

      switch (t) {
        case SDNATypes.STRUCT:
          value = readSDNA(type.subtype);
          break;
        case SDNATypes.VOID:
          break;
        case SDNATypes.ARRAY: {
          value = readArray(type);
          break;
        }
        case SDNATypes.POINTER:
          value = r.uint64()
          //console.log(BigInt(Number(value)) - value);
          //value = Number(value);
          break;
        case SDNATypes.INT64_T:
          value = unsigned ? r.uint64() : r.int64();
          break;
        case SDNATypes.LONG:
        case SDNATypes.INT:
          value = unsigned ? r.uint32() : r.int32();
          break;
        case SDNATypes.SHORT:
          value = unsigned ? r.uint16() : r.int16();
          break;
        case SDNATypes.CHAR:
          value = unsigned ? r.uint8() : r.int8();
          break;
        case SDNATypes.FLOAT:
          value = r.float32();
          break;
        case SDNATypes.DOUBLE:
          value = r.float64();
          break;
        default:
          throw new BlendReadError("invalid type " + t);
      }

      return value;
    }

    let readSDNA = (st) => {
      let d = new (st.getClass())();

      for (let f of st._fields) {
        d[f.name] = readValue(f.type);
      }

      return d;
    }

    return readSDNA(st);
  }

  link() {
    let bheads = this.bfile.bheads;
    let oldmap = this.bfile.oldmap;
    let main = this.bfile.main;

    let readString = (arr) => {
      let s = '';

      for (let c of arr) {
        if (c === 0) {
          break;
        }

        s += String.fromCharCode(c);
      }

      return s;
    }

    let flattenLinkList = (list) => {
      let ret = [];
      let item = list.first;

      while (item) {
        ret.push(item);
        item = item.next;
      }

      return ret;
    };

    bheads = bheads.filter(bh => !nonblocks.has(bh.id));

    for (let bh of bheads) {
      bh.data.id.name = readString(bh.data.id.name);
      bh.data.id.name = bh.data.id.name.slice(2, bh.data.id.name.length);

      let key = bh.id.toLowerCase();

      if (!(key in main)) {
        main[key] = [];
      }


      main[key].push(bh.data);
    }

    const visit = new WeakSet();
    let deferred_links = [];

    var linkStruct = (st, obj, fpath = st.name, parent) => {
      if (obj === undefined) {
        console.log(parent, fpath);
      }
      visit.add(obj);

      for (let f of st._fields) {
        if (f.type.type === SDNATypes.POINTER) {
          let ptr = obj[f.name];

          if (ptr === 0n) {
            obj[f.name] = null;
          } else {
            let obj2 = oldmap.get(ptr);

            if (obj2 && obj2 instanceof ArrayBuffer) {
              if (f.type.subtype.type !== SDNATypes.VOID) {
                /* Instantiate non-struct DATA block */
                obj2 = this.finishDataBlock(obj2, f.type.subtype, ptr);
              } else {
                if (st.name === "IDPropertyData" || st.name === "CustomDataLayer") {
                  /* ID properties and customdata layers are dealt with later. */
                } else {
                  /* Retry later. */
                  deferred_links.push({
                    obj, ptr, f, fpath
                  });
                }
              }
            }

            if ((obj2 instanceof BigUint64Array || obj2 instanceof BigInt64Array) &&
              f.type.subtype.type === SDNATypes.POINTER) {
              obj2 = util.list(obj2);
              obj2 = obj2.map(ptr => oldmap.get(ptr)).map(obj => obj === undefined ? null : obj);
            }

            if (obj2) {
              obj[f.name] = obj2;
            } else {
              if (DEBUG_UNKNOWN_POINTERS) {
                console.log("Unknown ptr for " + f.name, ptr);
              }
              obj[f.name] = null;
            }
          }
        } else if (f.type.type === SDNATypes.STRUCT) {
          linkStruct(f.type.subtype, obj[f.name], fpath + "." + f.name, obj);
        } else if (f.type.type === SDNATypes.ARRAY) {
          linkStaticArray(obj[f.name], f.type, fpath + "." + f.name);
        }
      }
    };

    var linkStaticArray = (obj, type, fpath = "") => {
      if (type.subtype.type === SDNATypes.ARRAY) {
        for (let i = 0; i < type.params; i++) {
          linkStaticArray(obj[i], type.subtype, fpath + `[${i}]`);
        }
      } else if (type.subtype.type === SDNATypes.STRUCT) {
        for (let i = 0; i < type.params; i++) {
          linkStruct(type.subtype.subtype, obj[i], fpath + `[${i}]`, obj);
        }
      } else if (type.subtype.type === SDNATypes.POINTER) {
        for (let i = 0; i < type.params; i++) {
          obj[i] = oldmap.get(obj[i]);
        }
      }
    };

    let idprop_sdna_nr = this.bfile.sdna.structs["IDProperty"].nr;
    let cdata_sdna_nr = this.bfile.sdna.structs["Mesh"].nr;

    for (let bh of this.bfile.bheads) {
      if (bh.sdna === cdata_sdna_nr) {
        //console.log("FOUND CDATA");
        for (let data of bh.iterBlocks()) {
          //console.log(oldmap.get(data.vdata.layers));
        }
      }
    }

    for (let bh of bheads) {
      if (bh.data instanceof ArrayBuffer) {
        continue;
      }

      for (let data of bh.iterBlocks()) {
        linkStruct(data[StructSym], data);
      }
    }

    for (let bh of this.bfile.bheads) {
      let ok = bh.id === "GLOB";
      ok = ok && !(bh.data instanceof ArrayBuffer);

      if (bh.id === "DATA") {
        /* Quick check. */
        if (bh.sdna > 0) {
          ok = true;
        } else if (!(bh.data instanceof ArrayBuffer)) {
          let data = bh.data;
          if (bh.nr > 1) {
            data = data[0];
          }

          ok = data[StructSym] !== undefined;
        }
      }

      //console.log(ok, visit.has(bh.data), bh.id, bh.sdna, bh.nr);

      ok = ok && !visit.has(bh.data);

      if (ok) {
        if (bh.nr > 1) {
          for (let i = 0; i < bh.nr; i++) {
            linkStruct(bh.data[i][StructSym], bh.data[i]);
          }
        } else {
          linkStruct(bh.data[StructSym], bh.data);
        }
      }
    }

    if (deferred_links.length > 0) {
      throw new Error("failed to link something.");
    }

    /* CustomData Layers. */
    let cd_lay_sdna_nr = this.bfile.sdna.structs["CustomDataLayer"].nr;
    //let cd_sdna_nr = this.bfile.sdna.structs["CustomData"].nr;

    for (let bh of this.bfile.bheads) {
      if (bh.id === "DATA" && bh.sdna === cd_lay_sdna_nr) {
        for (let layer of bh.iterBlocks()) {
          layer.name = readString(layer.name);
          layer.data = readCustomDataLayer(layer, this.bfile.sdna, this.readStruct.bind(this));
        }
      }
    }


    /**** ID properties *****/

    let i32buf = new Int32Array(2);
    let f32buf = new Float32Array(i32buf.buffer);
    let f64buf = new Float64Array(i32buf.buffer);

    let i32_to_f32 = (i) => {
      i32buf[0] = i;
      return f32buf[0];
    };
    let i32_to_f64 = (i1, i2) => {
      i32buf[0] = i1;
      i32buf[1] = i2;
      return f64buf[0];
    };


    let readIDProperty = (idp, lvl = 0) => {
      if (typeof idp.name !== "string") {
        idp.name = readString(idp.name);
      }

      switch (idp.type) {
        case eIDPropertyType.IDP_FLOAT:
          idp.data.val = i32_to_f32(idp.data.val);
          break;
        case eIDPropertyType.IDP_DOUBLE:
          idp.data.val = i32_to_f64(idp.data.val, idp.data.val2);
          break;
        case eIDPropertyType.IDP_BOOLEAN:
          idp.data.val = Boolean(idp.data.val);
          break;
        case eIDPropertyType.IDP_STRING:
          idp.data.pointer = readString(new Uint8Array(idp.data.pointer));
          break;
        case eIDPropertyType.IDP_GROUP:
          idp.data.group = flattenLinkList(idp.data.group);
          idp.data.props = {};

          for (let idp2 of idp.data.group) {
            readIDProperty(idp2, lvl + 1);
            idp.data.props[idp2.name] = idp2;
          }
          break;
        case eIDPropertyType.IDP_IDPARRAY:
          if (!idp.data.pointer) {
            idp.data.pointer = [];
          }

          for (let idp2 of idp.data.pointer) {
            readIDProperty(idp2, lvl + 1);
          }

          break;
        case eIDPropertyType.IDP_ID:
          break;
        case eIDPropertyType.IDP_ARRAY: {
          let data = idp.data.pointer;
          let origbuffer = data ? data[OrigBuffer] : null;

          switch (idp.subtype) {
            case eIDPropertyType.IDP_FLOAT:
              data = new Float32Array(data, 0, idp.len);
              break;
            case eIDPropertyType.IDP_DOUBLE:
              data = new Float64Array(data, 0, idp.len);
              break;
            case eIDPropertyType.IDP_INT:
              data = new Int32Array(data, 0, idp.len);
              break;
            case eIDPropertyType.IDP_BOOLEAN:
              data = util.list(new Uint8Array(data, 0, idp.len)).map(f => Boolean(f));
              break;
          }

          data[OrigBuffer] = origbuffer;

          if (idp.subtype === eIDPropertyType.IDP_BOOLEAN) {
            idp.data.pointer = data;
          }
          break;
        }
      }
    };


    for (let bh of this.bfile.bheads) {
      if (bh.id !== "DATA" || bh.sdna !== idprop_sdna_nr) {
        continue;
      }

      if (bh.nr > 1) {
        for (let i = 0; i < bh.nr; i++) {
          readIDProperty(bh.data[i]);
        }
      } else {
        readIDProperty(bh.data);
      }
    }

    for (let dl of deferred_links) {
      console.log(dl.obj[StructSym].name); //oldmap.get(dl.ptr), dl.f.name, dl.fpath);
    }
  }

  /* Data is an arraybuffer. */
  finishDataBlock(data, type, ptr) {
    let typemask = type.type;
    let t = typemask & SDNATypes.TYPEMASK;
    let unsigned = typemask & SDNATypes.UNSIGNED || t === SDNATypes.POINTER;

    switch (t) {
      case SDNATypes.CHAR:
        data = !unsigned ? new Uint8Array(data) : new Int8Array(data);
        break;
      case SDNATypes.SHORT:
        data = !unsigned ? new Uint16Array(data) : new Int16Array(data);
        break;
      case SDNATypes.LONG:
      case SDNATypes.INT:
        data = !unsigned ? new Uint32Array(data) : new Int32Array(data);
        break;
      case SDNATypes.POINTER:
      case SDNATypes.INT64_T:
        data = !unsigned ? new BigInt64Array(data) : new BigUint64Array(data);
        break;
      case SDNATypes.FLOAT:
        data = new Float64Array(data);
        break;
      case SDNATypes.DOUBLE:
        data = new Float32Array(data);
        break;
      case SDNATypes.ARRAY:
      case SDNATypes.STRUCT:
        //console.log("---", this.bfile.oldmap_bhead.get(ptr));
        //readStruct
        let stt = type.subtype;
        let count = data.byteLength/type.subtype.size;
        //console.trace("Readdata", type, type.subtype.size, count, data.byteLength);
        console.log("STRUCT readdata", type.type);
        throw new Error("STRUCT readdata");
        break;
      default:
        throw new BlendReadError("blendfile array read error, unknown type " + t);
    }

    return data;
  }
}
