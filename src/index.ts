import { Program, EmitOptionsFor, navigateProgram, Type, DecoratorContext, ModelType, ModelTypeProperty, ArrayType, getIntrinsicModelName } from "@cadl-lang/compiler";
import { DataStoreLibrary } from "./lib.js";
import {mkdir, writeFile} from "fs/promises";
import * as path from "path";

interface DataStoreEmitterOptions {
  outputDir: string;
}

const storeKey = Symbol()
export function $store({program}: DecoratorContext, t: Type) {
  program.stateMap(storeKey).set(t, false);
}

export async function $onEmit(p: Program, options: EmitOptionsFor<DataStoreLibrary>) {
  const outputDir = path.join(p.compilerOptions.outputPath!, "store");
  const emitter = createTsEmitter(p, {outputDir});
  emitter.emit();
}

const instrinsicNameToTSType = new Map<string, string>([
  ['string', 'string'],
  ['int32', 'number'],
  ['int16', 'number'],
  ['float16', 'number'],
  ['float32', 'number'],
  ['int64', 'bigint'],
  ['boolean', 'boolean']
]);

function createTsEmitter(p: Program, options: DataStoreEmitterOptions) {
  let typeDecls: string[] = [];
  const knownTypes = new Map<Type, string>();

  return {
    emit
  }

  async function emit() {
    await mkdir(options.outputDir, { recursive: true });
    for (const [model, collectionName] of (p.stateMap(storeKey) as Map<ModelType, any>)) {
      emitStoreInterface(model, collectionName ?? model.name);
    };
  }

  function emitStoreInterface(model: ModelType, collectionName: string) {
    let storeCode = `
    import { CosmosClient, Database, Container } from "@azure/cosmos";

    class ${model.name}Store {
      private client: CosmosClient;
      private databaseId: string;
      private containerId: string;
      private container!: Container;
      private database!: Database;
      constructor(client: CosmosClient, databaseId: string, containerId: string) {
        this.client = client;
        this.databaseId = databaseId;
        this.containerId = containerId;
      }
    
      async init() {
        const { database } = await this.client.databases.createIfNotExists({
          id: this.databaseId,
        });
        const { container } = await database.containers.createIfNotExists({
          id: this.containerId,
        });
        this.database = database;
        this.container = container;
      }
    
      async get(id: string): Promise<${model.name}> {
        let { resource } = await this.container.item(id).read();
        return resource;
      }
    }    
    `;
    const outPath = path.join(options.outputDir, model.name + ".ts");
    
    typeDecls = [];
    getTypeReference(model);
    for (const decl of typeDecls) {
      storeCode += decl + "\n";
    }
    writeFile(outPath, storeCode);
  }

  
  function getTypeReference(type: Type): string {
    if (knownTypes.has(type)) {
      return knownTypes.get(type)!;
    }
  
    switch (type.kind) {
      case "Model": return generateModelType(type);
      case "Array": return generateArrayType(type);
      case "Number": return type.value.toString();
      case "Union": return type.options.map(getTypeReference).join("|")
      default: 
        // todo: diagnostic
        return "{}";
    }
  
  }
  
  function generateArrayType(type: ArrayType) {
    return `${getTypeReference(type.elementType)}[]`;
  }
  
  function generateModelType(type: ModelType): string {
    const intrinsicName = getIntrinsicModelName(p, type);
    if (intrinsicName) {
      if (!instrinsicNameToTSType.has(intrinsicName)) {
        throw new Error("Unknown intrinsic type " + intrinsicName);
      }
  
      return instrinsicNameToTSType.get(intrinsicName)!;
    }
  
    const props: string[] = [];
  
    for (const prop of type.properties.values()) {
      props.push(`${prop.name}${prop.optional ? '?' : ''}: ${getTypeReference(prop.type)}`);
    }
  
    const typeRef = getModelDeclarationName(type);
  
    const typeStr = `interface ${typeRef} {
      ${props.join(",")}
    }`
  
    typeDecls.push(typeStr)
  
    knownTypes.set(type, typeRef)
  
    return typeRef;
  }
  
  function getModelDeclarationName(type: ModelType): string {
    // todo: why is this possibly undefined?
  
    if (type.templateArguments === undefined || type.templateArguments.length === 0) {
      return type.name;
    }
  
    // todo: this probably needs to be a lot more robust
    const parameterNames = type.templateArguments.map(t => {
      switch (t.kind) {
        case "Model": return getModelDeclarationName(t);
        case "Array": 
          if (t.elementType.kind === "Model") {
            return getModelDeclarationName(t.elementType) + 'Array';
          }
          // fallthrough
        default: throw new Error("Can't get a name for non-model type used to instantiate a model template")
      }
  
      
    });
  
    return type.name + parameterNames.join("");
  }

  function getModelProperty(model: ModelTypeProperty) {

  }
}