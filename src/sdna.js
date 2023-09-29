"use strict";

import {IDGen} from './util.js';
import {Endian} from './binfile.js';
import {StructSym, PointerSym} from './enums.js';

export let ENDIAN_BIG = Endian.BIG;
export let ENDIAN_LITTLE = Endian.LITTLE;

export let sdna_instance_idgen = new IDGen();

let _debug = 0;

export class SDNASubClass {
  constructor() {
  }
}

export let SDNATypes = {
  INT    : 1,
  SHORT  : 2,
  CHAR   : 3, //always unsigned
  FLOAT  : 4,
  DOUBLE : 5,
  LONG   : 6,
  INT64_T: 7,
  POINTER: 8,
  STRUCT : 9,
  ARRAY  : 10, //arrays are store nested, with first dimensions being leaf nodes
              //e.g. array[3][2] would be stored as type(array[2], type(array[3]));
  VOID    : 11,
  UNSIGNED: 64,
  TYPEMASK: 15
};

let SDNATypeNames = {}

function build_SDNATypeNames() { //supposedly, doing it this way helps with optimization
  for (let k in SDNATypes) {
    SDNATypeNames[SDNATypes[k]] = k
  }
}

build_SDNATypeNames();

export let BasicTypes = {
  "char"    : SDNATypes.CHAR, //sign chars are not actually allowed
  "uchar"   : SDNATypes.CHAR,
  "int8_t"  : SDNATypes.CHAR | SDNATypes.UNSIGNED,
  "uint8_t" : SDNATypes.CHAR,
  "short"   : SDNATypes.SHORT,
  "ushort"  : SDNATypes.SHORT | SDNATypes.UNSIGNED,
  "int"     : SDNATypes.INT,
  "uint"    : SDNATypes.INT | SDNATypes.UNSIGNED,
  "long"    : SDNATypes.LONG,
  "ulong"   : SDNATypes.LONG | SDNATypes.UNSIGNED,
  "float"   : SDNATypes.FLOAT,
  "double"  : SDNATypes.DOUBLE,
  "int64_t" : SDNATypes.INT64_T,
  "uint64_t": SDNATypes.INT64_T | SDNATypes.UNSIGNED,
  "void"    : SDNATypes.VOID,
}

function tab(size) {
  let s = "";

  for (let i = 0; i < size; i++) {
    s += " "
  }

  return s;
}

let SDNAType_read_stack = new Array(4096);

export class SDNAType {
  constructor(type, subtype = -1, params = undefined) {
    this.type = type;
    this.subtype = subtype;
    this.params = params; //e.g. array dimensions
  }

  read_stack(fd) {
    let stack = SDNAType_read_stack;
    let _stack_cur = 0;

    function push(item) {
      if (stack.length === _stack_cur)
        stack.push(0);

      if (_stack_cur < 0) {
        console.log(_stack_cur, stack, item);
        throw new Error("eek!");
      }

      stack[_stack_cur++] = item;
    }

    function pop() {
      if (_stack_cur < 0) return undefined;
      return stack[_stack_cur--];
    }

    function top(i = 0) {
      if (_stack_cur - i < 0) return undefined;

      return stack[_stack_cur - i];
    }

    let STATE_RETURN = 0;
    let STATE_ENTER = 1;

    push(this); //this
    push(fd);   //fd
    push(STATE_ENTER);

    let _ci = 0;

    while (stack.length > 0) {
      let state = stack.pop(0);
      let val = undefined;

      if (state === STATE_RETURN) {
        val = stack.pop();
      }

      let fd = top(0);
      let typethis = top(1);

      if (_ci++ > 10000) {
        console.log("infinite loop");
        break;
      }

      console.log(_ci, stack, typethis, fd);

      let type = typethis.type & SDNATypes.TYPEMASK;

      if (type !== SDNATypes.ARRAY && type !== SDNATypes.STRUCT) {
        //get rid of fd/typethis from primitive types
        pop();
        pop();
      }

      if (state === STATE_RETURN) {
        let val = pop();

        //find owner
        if (stack.length === 0) {
          return val; //yay!
        }

        fd = top(0);
        typethis = top(1);

        type = typethis.type & SDNATypes.TYPEMASK;

        if (type === SDNATypes.ARRAY) {
          //find our array value
          let array = top(2);
          array.push(val);

          if (array.length < typethis.params) {
            pop();
            pop();

            //array should be in the right place. . .hopefully
            push(STATE_RETURN);
          }
        } else if (type === SDNATypes.STRUCT) {
          pop();
          pop();

          push(STATE_RETURN);
        }
      }

      let unsign = typethis.type & SDNATypes.UNSIGNED;

      switch (typethis.type & SDNATypes.TYPEMASK) {
        case SDNATypes.INT:
          push(unsign ? fd.read_uint() : fd.read_int());
          push(STATE_RETURN);
          break;
        case SDNATypes.SHORT:
          push(unsign ? fd.read_ushort() : fd.read_short());
          push(STATE_RETURN);
          break;
        case SDNATypes.CHAR: //always unsigned
          push(fd.read_byte());
          push(STATE_RETURN);
          break;
        case SDNATypes.FLOAT:
          push(fd.read_float());
          push(STATE_RETURN);
          break;
        case SDNATypes.DOUBLE:
          push(fd.read_double());
          push(STATE_RETURN);
          break;
        case SDNATypes.LONG:
          push(unsign ? fd.read_ulong : fd.read_long());
          push(STATE_RETURN);
          break;
        case SDNATypes.INT64_T:
          push(unsign ? fd.read_uint64_t() : fd.read_int64_t());
          push(STATE_RETURN);
          break;
        case SDNATypes.POINTER:
          push(fd.read_pointer());
          push(STATE_RETURN);
          break;
        case SDNATypes.STRUCT:
          push(typethis.subtype.read(fd));
          push(STATE_RETURN);
          break;

        //arrays are store nested, with first dimensions being leaf nodes
        //e.g. array[3][2] would be stored as type(array[2], type(array[3]));
        case SDNATypes.ARRAY:
          let ret = [];

          if (typethis.subtype.type === SDNATypes.CHAR) {
            ret = fd.read_string(typethis.params);
            console.log(tab(depth) + "string", ret);

            push(ret);
            push(STATE_RETURN);
            break;
          }

          stack.push([]);
          stack.push(typethis.subtype);
          stack.push(fd);
          stack.push(STATE_ENTER);

          break;
        case SDNATypes.VOID:
          push(undefined);
          push(STATE_RETURN);
          break;
      }
    }
  }

  read(fd, depth = 0) {
    let unsign = this.type & SDNATypes.UNSIGNED;

    if (_debug) {
      console.log(tab(depth) + "reading", this.name)
    }

    switch (this.type & SDNATypes.TYPEMASK) {
      case SDNATypes.INT:
        return unsign ? fd.read_uint() : fd.read_int();
      case SDNATypes.SHORT:
        return unsign ? fd.read_ushort() : fd.read_short();
      case SDNATypes.CHAR: //always unsigned
        return fd.read_byte();
      case SDNATypes.FLOAT:
        return fd.read_float();
      case SDNATypes.DOUBLE:
        return fd.read_double();
      case SDNATypes.LONG:
        return unsign ? fd.read_ulong : fd.read_long();
      case SDNATypes.INT64_T:
        return unsign ? fd.read_uint64_t() : fd.read_int64_t();
      case SDNATypes.POINTER:
        return fd.read_pointer();
      case SDNATypes.STRUCT:
        return this.subtype.read(fd, depth + 1);

      //arrays are store nested, with first dimensions being leaf nodes
      //e.g. array[3][2] would be stored as type(array[2], type(array[3]));
      case SDNATypes.ARRAY:
        let ret = [];

        if (this.subtype.type === SDNATypes.CHAR) {
          ret = fd.read_string(this.params);

          if (_debug) {
            console.log(tab(depth) + "string", ret);
          }

          return ret;
        }

        for (let i = 0; i < this.params; i++) {
          ret.push(this.subtype.read(fd, depth + 1));
        }

        return ret;
        break;
      case SDNATypes.VOID:
        return undefined;
    }
  }

  static array(type, dimensions) {
    return new SDNAType(SDNATypes.ARRAY, type, dimensions);
  }

  static pointer(type) {
    return new SDNAType(SDNATypes.POINTER, type, undefined);
  }

  static struct(type) {
    return new SDNAType(SDNATypes.STRUCT, type, undefined);
  }

  static from_string(type, name, sdna) {
    name = name.trim();

    let do_print = false;

    if (type in sdna.structs) {
      type = SDNAType.struct(sdna.structs[type]);
    } else if (type in BasicTypes) {
      type = new SDNAType(BasicTypes[type]);
    } else {
      //console.log("\nUnknown type", type, "\n");
      type = new SDNAType(SDNATypes.VOID);
    }

    let i = 0;
    let name2 = ""
    let indim = false;

    while (i < name.length) {
      let c = name[i];
      if (c === "*" && !indim) {
        type = SDNAType.pointer(type);
      } else if (c === "[") {
        indim = true;

        let dim = "";
        i++;
        while (name[i] !== "]") {
          dim += name[i];
          i++;
        }
        dim = parseInt(dim);

        type = SDNAType.array(type, dim);
      } else if (c !== "[" && c !== "]" && c !== "(" && c !== ")" &&
        c !== "*" && c !== " " && c !== "\t") {
        name2 += c;
      }
      i++;
    }

    if (do_print) {
      console.log(name, type);
    }

    type.name = name2;

    return type;
  }
}

export class SDNAParseError extends Error {
  constructor(message) {
    super(message)
  }
}

export class SDNAField {
  constructor(name, type) {
    this.name = name;
    this.type = type; //an SDNAType
    this.off = -1; //XXX make sure to calculate me!
  }

  read(fd, depth = 0) {
    let ret = this.type.read(fd, depth);
    return ret;
  }

  copy() {
    let ret = new SDNAField();
    ret.name = this.name;
    ret.type = this.type.copy();
    ret.off = this.off;

    return ret;
  }
}

function getTypeSize(type, offset) {
  let t = type.type & SDNATypes.TYPEMASK;

  switch (t) {
    case SDNATypes.CHAR:
      return 1;
    case SDNATypes.SHORT:
      return 2;
    case SDNATypes.LONG:
    case SDNATypes.FLOAT:
    case SDNATypes.INT:
      return 4;
    case SDNATypes.POINTER:
    case SDNATypes.DOUBLE:
      return 8;
    case SDNATypes.STRUCT: {
      let stt = type.subtype;
      if (stt.size === -1) {
        stt.calcSize(offset);
      }

      return stt.size;
    }
    case SDNATypes.ARRAY: {
      let size = 0;

      for (let i = 0; i < type.params; i++) {
        size += getTypeSize(type.subtype);
      }

      return size;
    }
    case SDNATypes.INT64_T:
    case SDNATypes.VOID:
      return 8; /* Should be a function pointer. */
    default:
      console.log(type)
      throw new Error("invalid type " + t);
  }
}

let instIdGen = 0;

export class SDNAStruct {
  #class = null;

  constructor(name, typeid, fields, nr) {
    this.name = name;
    this.typeid = typeid;
    this.fields = fields;
    this._fields = undefined;
    this.size = -1;
    this.nr = nr;

    /* Instance id. */
    this.instId = instIdGen++;
  }

  getClass() {
    if (this.#class) {
      return this.#class;
    }

    let props = '';

    for (let f of this._fields) {
      props += `      ${f.name} = `
      switch (f.type.type) {
        case SDNATypes.ARRAY:
        case SDNATypes.POINTER:
        case SDNATypes.STRUCT:
          props += 'null';
          break;
        default:
          props += '0';
          break;
      }

      props += ";\n";
    }

    let code = `
    this.#class = class ${this.name} {
      static sdna = null;
      
      [PointerSym] = 0;
      [StructSym] = null;
      
      ${props}
      
      constructor() {
        this[StructSym] = this.constructor.sdna;
      }
    }
    `

    eval(code);

    this.#class.sdna = this;

    return this.#class;
  }

  calcSize(offset = 0) {
    let size = 0;

    for (let f of this._fields) {
      f.off = offset;

      let fsize = getTypeSize(f.type, offset);

      size += fsize;
      offset += fsize;
    }

    this.size = size;
  }

  read_field(fd, field, depth = 0) {
    return field.read(fd, depth);
  }

  read_into(fd, obj, depth = 0) {
    for (let i = 0; i < this._fields.length; i++) {
      let field = this._fields[i];
      obj[field.name] = this.read_field(fd, field, depth);
    }

    return obj;
  }

  read(fd, depth = 0) {
    let typemanager = fd.host_typemanager;
    if (this.name in typemanager) {
      let ret = new typemanager[this.name]();

      if (ret._bl_instance_id === undefined) {
        console.trace("WARNING: you forgot to call super() in an SDNA-derived type constructor!", this.name);
        ret._bl_instance_id = sdna_instance_idgen.next();
      }
    } else {
      let ret = {};

      ret._bl_sdna = this;
      ret._bl_instance_id = sdna_instance_idgen.next();

      ret.constructor = {};
      ret.constructor.name = this.name;
      ret.constructor.prototype = Object.create(SDNASubClass.prototype);
      ret.prototype = ret.constructor.prototype;
    }

    this.read_into(fd, ret, depth);

    return ret;
  }

  link(block, fd) {
    //console.log(block._bl_instance_id, block);

    if (fd.link_doneset.has(block._bl_instance_id)) {
      return;
    }

    function field_recurse(data, type) {
      if (type.type === SDNATypes.POINTER) {
        if (fd.oldmap.has(data)) {
          data = fd.oldmap.get(data);
        }
      } else if (type.type === SDNATypes.ARRAY) {
        for (let i = 0; i < type.type.params; i++) {
          data[i] = field_recurse(data[i], type.subtype);
        }
      }

      return data;
    }

    for (let i = 0; i < this._fields.length; i++) {
      let f = this._fields[i];
      //console.log(f.type.type);

      if (f.type.type === SDNATypes.STRUCT) {
        let ob = block[f.name];
        ob._bl_sdna.link(ob, fd);

        continue;
      }
      if (f.type.type !== SDNATypes.POINTER && f.type.type !== SDNATypes.ARRAY)
        continue;

      if (f.type.type === SDNATypes.POINTER) {
        //console.log("link!");
      }

      let member = block[f.name];
      member = field_recurse(member, f.type);

      block[f.name] = member;
    }

    fd.link_doneset.add(block._bl_instance_id);
  }

  copy() {
    let ret = new SDNAStruct()

    ret.#class = this.#class;
    ret.name = this.name;
    ret.typeid = this.typeid;
    ret.nr = this.nr;

    ret.fields = {};
    ret._fields = [];

    for (let k in this.fields) {
      let field = this.fields[k].copy();
      ret._fields.push(field);
      ret.fields[k] = field;
    }

    return ret;
  }
}

export class SDNA {
  constructor(structs, types, typelens, structlist, ptrsize, endian) {
    this.pointer_size = ptrsize;
    this.endian = endian;
    this.structs = structs; //a map
    this.structlist = structlist;
    this.types = types;     //an array
    this.typelens = typelens;
  }

  //bhead should be a fileapi.BHead object
  //fd should be a fileapi.FileData object
  read(bhead, fd) {
    let stt = this.structlist[bhead.sdna];

    if (bhead.nr > 1) {
      let ret = [];

      for (let i = 0; i < bhead.nr; i++) {
        ret.push(stt.read(fd));
      }

      return ret;
    } else {
      return stt.read(fd);
    }
  }
}

export class SDNAParser {
  constructor() {
  }

  parse(code, endian, ptrsize) {
    code = new Uint8Array(code);
    let view = new DataView(code.buffer);
    let ci = 8; //file cursor

    function streq(off, str) {
      let str2 = ""
      for (let i = off; i < off + str.length; i++) {
        str2 += String.fromCharCode(code[i]);
      }

      return str2 === str
    }

    function read_strn(len) {
      let str2 = ""
      let off = ci;
      let i;

      for (i = off; i < off + len; i++) {
        str2 += String.fromCharCode(code[i]);
      }

      ci = i;
      return str2;
    }

    if (!streq(0, "SDNA")) {
      throw new SDNAParseError("expected SDNA");
    }
    if (!streq(4, "NAME")) {
      throw new SDNAParseError("expected NAME");
    }

    function read_int(off = ci) {
      ci += 4;
      return view.getInt32(off, endian == ENDIAN_LITTLE);
    }

    function read_short(off = ci) {
      ci += 2;

      return view.getInt16(off, endian == ENDIAN_LITTLE);
    }

    function read_str(off = ci) {
      let i = off;
      let ret = ""

      while (code[i]) {
        ret += String.fromCharCode(code[i]);
        i++;
      }

      ci = i + 1;
      return ret;
    }

    //read name fields
    let totname = read_int();

    let names = [], types = [], typelens = [], structs = [];
    console.log("totname", totname, "str", read_str(4, 4));

    while (!code[ci]) {
      ci++;
    }

    for (let i = 0; i < totname; i++) {
      let name = read_str();
      names.push(name);
    }

    //console.log(names);

    ci = (ci + 3) & ~3;
    if (read_strn(4) !== "TYPE") {
      throw new Error("missing type column!");
    }

    let tottype = read_int();

    for (let i = 0; i < tottype; i++) {
      let type = read_str();

      //from dna_genfile.c
      /* this is a patch, to change struct names without a conflict with SDNA */
      /* be careful to use it, in this case for a system-struct (opengl/X) */
      /* struct Screen was already used by X, 'bScreen' replaces the old IrisGL 'Screen' struct */
      if (type === "bScreen") {
        type = "Screen";
      }

      types.push(type);
    }

    //console.log(types);

    ci = (ci + 3) & ~3;
    if (read_strn(4) !== "TLEN") {
      throw new Error("missing type len column!");
    }

    for (let i = 0; i < tottype; i++) {
      typelens.push(read_short());
    }

    //console.log(typelens);

    ci = (ci + 3) & ~3;
    if (read_strn(4) !== "STRC") {
      throw new Error("missing struct column!");
    }

    let last_totfield = 0;
    let totstruct = read_int()
    for (let i = 0; i < totstruct; i++) {
      if (ci + 4 >= code.length) {
        console.log("Bounds error!!", last_totfield, structs)
        break;
      }

      //let start_ci = ci;
      let type = read_short();
      let totfield = read_short();
      //ci = start_ci;

      //console.log(type, totfield, types[type]);
      let fields = [];

      last_totfield = totfield;
      for (let j = 0; j < totfield; j++) {
        fields.push([types[read_short()], names[read_short()]]);
      }

      structs.push([type, totfield, fields]);
      //ci += (2*totfield+2)*2;
    }

    let smap = {}
    let structlist = [];

    for (let i = 0; i < structs.length; i++) {
      let stt = structs[i];
      let name = types[stt[0]];

      stt = new SDNAStruct(name, stt[0], stt[2], structlist.length);
      smap[name] = stt
      structlist.push(stt);
    }

    for (let k in smap) {
      let stt = smap[k];
      let fields = {}

      for (let i = 0; i < stt.fields.length; i++) {
        let type = stt.fields[i][0];

        fields[stt.fields[i][1]] = stt.fields[i] = new SDNAField(stt.fields[i][1], type);
      }

      stt._fields = stt.fields;
      stt.fields = fields;
    }

    this.sdna = new SDNA(smap, types, typelens, structlist, ptrsize, endian);
    this.sdna.typelens = typelens;

    for (let k in this.sdna.structs) {
      let stt = this.sdna.structs[k];
      stt.fields = {};

      for (let i = 0; i < stt._fields.length; i++) {
        let f = stt._fields[i];

        f.type = SDNAType.from_string(f.type, f.name, this.sdna);
        f.name = f.type.name;

        stt.fields[f.name] = f;
      }
    }

    for (let stt of this.sdna.structlist) {
      stt.calcSize();
    }

    return this.sdna;
  }
}

