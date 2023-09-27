import {eCustomDataTypeSDNA} from './enums.js';

const basicTypes = {
  "float" : 4,
  "int"   : 4,
  "short" : 2,
  "byte"  : 1,
  "double": 8,
  "void*" : 8,
};

export function readCustomDataLayer(layer, sdna, readStruct) {
  let ret = [];

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
      throw new Error("Unknown type " + type);
    }

    return sdna.structs[type].calcSize();
  }

  let elemSize = calcSize(type);

  console.log("CD", elemSize);
  return ret;
}
