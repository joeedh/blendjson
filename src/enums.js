export const eIDPropertyType = {
  IDP_STRING: 0,
  IDP_INT   : 1,
  IDP_FLOAT : 2,
  /** Array containing int, floats, doubles or groups. */
  IDP_ARRAY   : 5,
  IDP_GROUP   : 6,
  IDP_ID      : 7,
  IDP_DOUBLE  : 8,
  IDP_IDPARRAY: 9,
  /**
   * True or false value, backed by an `int8_t` underlying type for arrays. Values are expected to
   * be 0 or 1.
   */
  IDP_BOOLEAN: 10,
};

export const eCustomDataType = {
  CD_MVERT           : 0, /* note: not used in new .blend files. */
  CD_MDEFORMVERT     : 2, /* Array of `MDeformVert`. */
  CD_MEDGE           : 3, /* note: not used in new .blend files. */
  CD_MFACE           : 4,
  CD_MTFACE          : 5,
  CD_MCOL            : 6,
  CD_ORIGINDEX       : 7,
  CD_NORMAL          : 8,
  CD_PROP_FLOAT      : 10,
  CD_PROP_INT32      : 11,
  CD_PROP_STRING     : 12,
  CD_ORIGSPACE       : 13, /* for modifier stack face location mapping */
  CD_ORCO            : 14,      /* undeformed vertex coordinates, normalized to 0..1 range */
  CD_MTEXPOLY        : 15,
  CD_MLOOPUV         : 16,
  CD_PROP_BYTE_COLOR : 17,
  CD_TANGENT         : 18,
  CD_MDISPS          : 19,
  CD_PREVIEW_MCOL    : 20,           /* For displaying weight-paint colors. */
  CD_CLOTH_ORCO      : 23,
  CD_MPOLY           : 25, /* note: not used in new .blend files. */
  CD_MLOOP           : 26, /* note: not used in new .blend files. */
  CD_SHAPE_KEYINDEX  : 27,
  CD_SHAPEKEY        : 28,
  CD_BWEIGHT         : 29,
  CD_CREASE          : 30,
  CD_ORIGSPACE_MLOOP : 31,
  CD_PREVIEW_MLOOPCOL: 32,
  CD_BM_ELEM_PYPTR   : 33,

  CD_PAINT_MASK      : 34,
  CD_GRID_PAINT_MASK : 35,
  CD_MVERT_SKIN      : 36,
  CD_FREESTYLE_EDGE  : 37,
  CD_FREESTYLE_FACE  : 38,
  CD_MLOOPTANGENT    : 39,
  CD_TESSLOOPNORMAL  : 40,
  CD_CUSTOMLOOPNORMAL: 41,
  CD_SCULPT_FACE_SETS: 42,
  CD_PROP_INT8       : 45,
  CD_PROP_INT32_2D   : 46,

  CD_PROP_COLOR     : 47,
  CD_PROP_FLOAT3    : 48,
  CD_PROP_FLOAT2    : 49,
  CD_PROP_BOOL      : 50,
  CD_PROP_QUATERNION: 52,
};

let cd = eCustomDataType;

export const eCustomDataTypeSDNA = {
  [cd.CD_MVERT]           : "MVert",
  [cd.CD_MDEFORMVERT]     : "MDeformVert",
  [cd.CD_MEDGE]           : "MEdge",
  [cd.CD_MFACE]           : "MFace",
  [cd.CD_MTFACE]          : "MTFace",
  [cd.CD_MCOL]            : "MCol",
  [cd.CD_ORIGINDEX]       : "int",
  [cd.CD_NORMAL]          : "float:4",
  [cd.CD_PROP_FLOAT]      : "float",
  [cd.CD_PROP_INT32]      : "int",
  [cd.CD_PROP_STRING]     : "MStringProperty",
  [cd.CD_ORIGSPACE]       : "OrigSpaceFace",
  [cd.CD_ORCO]            : "float:4",
  [cd.CD_MTEXPOLY]        : "MLoopUV",
  [cd.CD_MTEXPOLY]        : "MTexPoly",
  [cd.CD_PROP_BYTE_COLOR] : "MLoopCol",
  [cd.CD_TANGENT]         : "float:16",
  [cd.CD_MDISPS]          : "MDisps",
  [cd.CD_PREVIEW_MCOL]    : "MCol:4",
  [cd.CD_CLOTH_ORCO]      : "float:3",
  [cd.CD_MLOOP]           : "MLoop",
  [cd.CD_MPOLY]           : "MPoly",
  [cd.CD_SHAPE_KEYINDEX]  : "int",
  [cd.CD_SHAPEKEY]        : "float:3",
  [cd.CD_BWEIGHT]         : "float",
  [cd.CD_CREASE]          : "float",
  [cd.CD_ORIGSPACE_MLOOP] : "OrigSpaceLoop",
  [cd.CD_PREVIEW_MLOOPCOL]: "MLoopCol",
  [cd.CD_BM_ELEM_PYPTR]   : "void*",
  [cd.CD_PAINT_MASK]      : "float",
  [cd.CD_GRID_PAINT_MASK] : "GridPaintMask",
  [cd.CD_MVERT_SKIN]      : "MVertSkin",
  [cd.CD_FREESTYLE_EDGE]  : "FreestyleEdge",
  [cd.CD_FREESTYLE_FACE]  : "FreestyleFace",
  [cd.CD_MLOOPTANGENT]    : "float:4",
  [cd.CD_TESSLOOPNORMAL]  : "short:12",
  [cd.CD_CUSTOMLOOPNORMAL]: "short:2",
  [cd.CD_SCULPT_FACE_SETS]: "int",
  [cd.CD_PROP_INT8]       : "byte",
  [cd.CD_PROP_INT32_2D]   : "int:2",
  [cd.CD_PROP_COLOR]      : "float:4",
  [cd.CD_PROP_FLOAT3]     : "float:3",
  [cd.CD_PROP_FLOAT2]     : "float:2",
  [cd.CD_PROP_BOOL]       : "byte",
  [cd.CD_PROP_QUATERNION] : "float:4",
};
