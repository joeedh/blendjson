import {SDNAParser, SDNAType, SDNATypes} from './sdna.js';
import {BinReader, Endian} from './binfile.js';
import {eCustomDataType, eIDPropertyType, OrigBuffer} from './enums.js';
import * as util from './util.js';
import {readCustomDataLayer} from './customdata.js';
import fs from 'fs';
import zlib from 'zlib';
import pathmod from 'path';

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
  constructor(id, data, old, sdna, nr) {
    this.id = id;
    this.data = data;
    this.old = old;
    this.sdna = sdna;
    this.nr = nr;
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
    let version = r.string(3);

    while (!r.eof()) {
      let id = r.string(4);
      let len = r.int32();
      let old = r.uint64();
      let sdna = r.int32();
      let nr = r.int32();

      let data = r.bytes(len);
      let bhead = new BHead(id, data, old, sdna, nr);

      if (bhead.id === "ENDB") {
        break;
      } else {
        this.bfile.bheads.push(bhead);
      }
    }

    let sdna;

    for (let bhead of this.bfile.bheads) {
      if (bhead.id === "DNA1") {
        sdna = bhead.data;
      }
    }

    if (!sdna) {
      throw new BlendReadError("Failed to find blendfile sdna data");
    }

    let parser = new SDNAParser();
    sdna = this.bfile.sdna = parser.parse(sdna, r.endian, 8);

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
    for (let i = 0; i < bh.nr; i++) {
      let data = this.readStruct(r, st);
      data[OrigBuffer] = origbuffer;

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

    var linkStruct = (st, obj, fpath = st.name, is_dblock) => {
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
          linkStruct(f.type.subtype, obj[f.name], fpath + "." + f.name);
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
          linkStruct(type.subtype.subtype, obj[i], fpath + `[${i}]`, false);
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
