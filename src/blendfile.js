import {SDNAParser, SDNAType, SDNATypes} from './sdna.js';
import {BinReader, Endian} from './binfile.js';
import {eIDPropertyType} from './enums.js';
import * as util from './util.js';
import {readCustomDataLayer} from './customdata.js';

export class BlendReadError extends Error {}

export const ParentSym = Symbol("parent");
export const StructSym = Symbol("struct");

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
}

let nonblocks = new Set([
  "DATA", "ENDB", "REND", "GLOB", "DNA1", "TEST"
]);

export class BlendFile {
  constructor(name) {
    this.name = name;
    this.bheads = [];
    this.oldmap = new Map();
    this.oldmap_bhead = new Map();
    this.sdna = undefined;
    this.main = {};
    this.version = 0;
  }

  printTree() {
    console.log("Printing blendfile tree");
    let file = this.makeTree();

    console.log(JSON.stringify(file, undefined, 1));
  }

  makeTree() {
    console.log("Printing blendfile tree");

    const blocks = new Map();
    const visit = new WeakSet();

    for (let k in this.main) {
      let list = this.main[k];
      for (let obj of list) {
        blocks.set(obj, k.toUpperCase());
      }
    }


    let file = {
      main: {}
    };

    var writeType = (val, type, fname) => {
      switch (type.type) {
        case SDNATypes.INT:
        case SDNATypes.SHORT:
        case SDNATypes.CHAR:
        case SDNATypes.FLOAT:
        case SDNATypes.DOUBLE:
          return val;
        case SDNATypes.STRUCT:
          return writeStruct(val, fname + `(${type.subtype.name})`);
        case SDNATypes.POINTER: {
          if (!val) {
            return null;
          }

          if (blocks.has(val)) {
            return blocks.get(val) + val.id.name;
          } else {
            console.log(type, val, fname);
            return writeType(val, type.subtype, fname);
          }
        }
      }
    };

    var writeStruct = (obj, fname) => {
      let st = obj[StructSym];
      let ret = {};

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

    let writeMainList = (k) => {
      let list = this.main[k];
      let list2 = file.main[k] = [];

      for (let obj of list) {
        let st = obj[StructSym];

        console.log(st);
        list2.push(writeStruct(obj), st.name);
      }
    }

    for (let k in this.main) {
      writeMainList(k);
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

    let r = new BinReader(bh.data);
    r.endian = this.r.endian;

    bh.data = [];
    for (let i = 0; i < bh.nr; i++) {
      bh.data.push(this.readStruct(r, st));
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
      let d = {
        [StructSym]: st
      };

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

    let linkStruct = (st, obj, fpath = st.name, is_dblock) => {
      if (st.name === "wmWindow") {
        console.log(obj);
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
                console.log("Readdata", st.name + ":" + f.name);
                obj2 = this.finishDataBlock(obj2, f.type.subtype, ptr);
              } else {
                /* Manually handle idproperties. */
                if (st.name === "CustomDataLayer") {
                  obj2 = readCustomDataLayer(obj, this.bfile.sdna, this.readStruct);
                } else if (st.name === "IDPropertyData") {
                  /* ID properties are relinked later. */
                } else {
                  /* Retry later. */
                  deferred_links.push({
                    obj, ptr, f, fpath
                  });
                }
              }
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
        }
      }
    };

    let idprop_sdna_nr = this.bfile.sdna.structs["IDProperty"].nr;

    for (let bh of bheads) {
      if (bh.data instanceof ArrayBuffer) {
        continue;
      }

      if (bh.nr > 1) {
        for (let i = 0; i < bh.nr; i++) {
          linkStruct(bh.data[i][StructSym], bh.data[i]);
        }
      } else {
        linkStruct(bh.data[StructSym], bh.data);
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
    process.exit();
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
