import {eCustomDataTypeSDNA, OrigBuffer, StructSym} from './enums.js';
import {BinReader} from './binfile.js';
import * as util from './util.js';

const basicTypes = {
  "float" : 4,
  "int"   : 4,
  "short" : 2,
  "byte"  : 1,
  "double": 8,
  "void*" : 8,
};

export function readCustomDataLayer(layer, sdna, readStruct) {
  let ret = layer.data;

  let type = eCustomDataTypeSDNA[layer.type];

  if (type === undefined) {
    throw new Error("Unknown customdata type " + layer.type);
  }

  function calcSize(type) {
    if (type in basicTypes) {
      return basicTypes[type];
    }

    if (type.search(":") > 0) {
      let [type2, dim] = type.split(":");
      dim = parseInt(dim);

      return calcSize(type2)*dim;
    }

    if (!(type in sdna.structs)) {
      /* Do nothing. */
      return -1;
    }

    return sdna.structs[type].calcSize();
  }

  let elemSize = calcSize(type);

  if (elemSize === -1) {
    throw new Error("unknown type");
    /* Invalid layer. */
    return layer.data; /* Return original data. */
  }

  let structMap = {
    "byte"   : "MInt8Property",
    "char"   : "MInt8Property",
    "float"  : "MFloatProperty",
    "int"    : "MIntProperty",
    "bool"   : "MBoolProperty",
    "float:2": "vec2f",
    "float:3": "vec3f",
    "float:4": "MPropCol",
    "int:2"  : "vec2i",
    "int:3"  : "vec3i",
  };

  function readData(type, r) {
    if (type.search(":") >= 0) {
      let [type2, dimen] = r.split(":");
      dimen = parseInt(dimen);

      let ret = [];
      for (let i = 0; i < dimen; i++) {
        ret.push(readData(type2, r));
      }

      return ret;
    } else if (type === "byte" || type === "char") {
      return r.uint8();
    } else if (type === "short") {
      return r.int16();
    } else if (type === "int") {
      return r.int32();
    } else if (type === "float") {
      return r.float32();
    } else if (type === "double") {
      return r.float64();
    } else if (type === "void*") {
      return r.uint64();
    }

    throw new Error("unknown type " + type);
  }

  let origbuf;

  if (layer.data instanceof ArrayBuffer) {
    origbuf = layer.data;

    let dimen = layer.data.byteLength/elemSize;
    let r = new BinReader(layer.data);
    ret = [];

    for (let i = 0; i < dimen; i++) {
      ret.push(readData(type, r));
    }

    if (type in structMap) {
      console.log("DERIVING", type, structMap[type]);
      ret[StructSym] = sdna.structs[structMap[type]];
    }

    ret[OrigBuffer] = layer.data;
  } else if (layer.data) {
    origbuf = layer.data[OrigBuffer];
  }


  if (ret) {
    ret[OrigBuffer] = origbuf;
    ret = unStructCustomDataLayer(ret);
  }

  return ret;
}

export function unStructCustomDataLayer(data) {
  if (!data) {
    return data;
  }

  let origbuffer = data[OrigBuffer];
  let ret = data;

  if (data instanceof Array && data.length > 0 && typeof data[0] === "object" && data[0][StructSym]) {
    let st = data[0][StructSym];

    if (st.name === "vec2f") {
      ret = data.map(f => [f.x, f.y]);
    } else if (st.name === "vec3f") {
      ret = data.map(f => [f.x, f.y, f.z]);
    } else if (st.name === "MPropCol") {
      ret = data.map(f => f.color);
    } else if (st.name === "vec2i") {
      ret = data.map(f => [f.x, f.y]);
    } else if (st.name === "MIntProperty") {
      ret = data.map(f => f.i);
    } else if (st.name === "MFloatProperty") {
      ret = data.map(f => f.f);
    }

    ret[StructSym] = st;
    ret[OrigBuffer] = origbuffer;
  }

  return ret;
}

export function structCustomDataLayer(data) {
  if (!data) {
    return data;
  }

  let st = data[StructSym];
  let origbuffer = data[OrigBuffer];

  if (data.length > 0 && typeof data[0] === "object" && data[0][StructSym]) {
    return;
  }

  if (!(data instanceof Array)) {
    data = util.list(data);
    data[StructSym] = st;
    data[OrigBuffer] = origbuffer;
  }

  let test = (name, cb) => {
    if (st.name !== name) {
      return;
    }

    for (let i = 0; i < data.length; i++) {
      let obj = new (st.getClass());
      cb(data[i], obj);
      data[i] = obj;
    }
  };

  test("vec2i", (val, obj) => {
    obj.x = ~~val[0];
    obj.y = ~~val[1];
  });
  test("vec3i", (val, obj) => {
    obj.x = ~~val[0];
    obj.y = ~~val[1];
    obj.z = ~~val[2];
  });
  test("vec2f", (val, obj) => {
    obj.x = val[0];
    obj.y = val[1];
  });
  test("vec3f", (val, obj) => {
    obj.x = val[0];
    obj.y = val[1];
    obj.z = val[2];
  });
  test("MPropCol", (val, obj) => {
    obj.color[0] = val[0];
    obj.color[1] = val[1];
    obj.color[2] = val[2];
    obj.color[3] = val[3];
  });
  test("MIntProperty", (val, obj) => obj.i = val);
  test("MFloatProperty", (val, obj) => obj.f = val);
  test("MInt8Property", (val, obj) => obj.i = val);
  test("MBoolProperty", (val, obj) => obj.b = val);

  return data;
}
