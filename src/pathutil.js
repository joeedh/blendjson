import pathmod from 'path';

export function normpath(path) {
  return pathmod.resolve(pathmod.normalize(path));
}

export * from 'path';
