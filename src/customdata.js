import {eCustomDataTypeSDNA, OrigBuffer, StructSym} from './enums.js';
import {BinReader} from './binfile.js';

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
    /* Invalid layer. */
    return layer.data; /* Return original data. */
  }

  function readData(type, r) {
    if (type.search(":") >= 0) {
      let [type2, dimen] = r.split(":");
      dimen = parseInt(dimen);

      let ret = [];
      for (let i = 0; i < dimen; i++) {
        ret.push(readData(type2, r));
      }

      return ret;
    } else if (type === "byte") {
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

    ret[OrigBuffer] = layer.data;
  } else if (layer.data) {
    origbuf = layer.data[OrigBuffer];
  }


  if (layer.data && typeof layer.data === "object" && layer.data.length > 0 && layer.data[0][StructSym]) {
    let st = layer.data[0][StructSym];

    if (st.name === "vec2f") {
      ret = layer.data.map(f => [f.x, f.y]);
    } else if (st.name === "vec3f") {
      ret = layer.data.map(f => [f.x, f.y, f.z]);
    } else if (st.name === "MPropCol") {
      ret = layer.data.map(f => f.color);
    } else if (st.name === "MCol" || st.name === "MLoopCol") {
      ret = layer.data.map(f => [f.r, f.g, f.b, f.a]);
    } else if (st.name === "vec2i") {
      ret = layer.data.map(f => [f.x, f.y]);
    } else if (st.name === "MIntProperty") {
      ret = layer.data.map(f => f.i);
    } else if (st.name === "MFloatProperty") {
      ret = layer.data.map(f => f.f);
    }
  }

  if (ret) {
    ret[OrigBuffer] = origbuf;
  }

  return ret;
}
