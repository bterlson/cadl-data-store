import { createCadlLibrary, paramMessage } from "@cadl-lang/compiler";

export const libDef = {
  name: "cadl-data-store",
  diagnostics: {
  },
  emitter: {
    names: ["cosmos"],
  },
} as const;
const lib = createCadlLibrary(libDef);
export const { reportDiagnostic } = lib;

export type DataStoreLibrary = typeof lib;
