import * as fs from 'fs'
import * as path from 'path'

type WasmPointer = number
type ICE = WasmPointer
interface ExtractInterface {
    [key: string] : WebAssembly.ExportValue,
    create_ice: (level: number) => ICE,
    set_ice: (ice: ICE, key: WasmPointer) => void,
    encrypt: (ice: ICE, plaintext: WasmPointer, compressed: WasmPointer, sections: number) => void,
    decrypt: (ice: ICE, compressed: WasmPointer, plaintext: WasmPointer, sections: number) => void,
    unpack: (input: WasmPointer, output: WasmPointer) => number,
    create_buffer: (length: number) => WasmPointer,
    destroy_buffer: (pointer: WasmPointer) => void,
}

const wasmpath = path.join(__dirname, './WASM/bdo-extract.wasm')
const wasmkey = '<insert key>'

class WasmBuffer {
    public pointer: WasmPointer
    constructor(public length: number, public instance: WebAssembly.Instance, public F: ExtractInterface){
        if (length <= 0) {
            throw new Error('Cannot create Wasm Buffer <= 0')
        }
        const offset = this.F.create_buffer(length)
        if (offset < 0) {
            throw new Error('Failed to create_buffer')
        }
        this.pointer = offset
    }

    read(length: number, offset: number) : Buffer {
        const readlength = length ? length : this.length
        const readoffset = offset ? offset : 0
        if (readlength <= 0) {
            throw new Error('Cannot read less than 0 bytes')
        }
        if (readoffset < 0 || (readoffset+readlength) > this.length) {
            //console.log(`${readlength} ${readoffset} ${this.length}`)
            throw new Error(`Cannot read past buffer length ${readoffset+readlength} > ${this.length}`)
        }
        // output underlying array
        const copybuf = new ArrayBuffer(readlength)
        
        // source wasm memory array
        const frombuf = (this.instance.exports.memory as WebAssembly.Memory).buffer

        // copy to output array
        new Uint8Array(copybuf).set(new Uint8Array(frombuf, this.pointer+readoffset, readlength))
        
        // create buffer view of output array
        return Buffer.from(copybuf)
    }

    write (data: Buffer, offset?: number, ) : void {
        const writeoffset = offset ? offset : 0
        if (data.length<=0) {
            throw new Error('Cannot write 0 bytes')
        }
        if ((writeoffset+data.length) > this.length) {
            throw new Error('Cannot write past buffer length')
        }
        const writebuffer = new Uint8Array((this.instance.exports.memory as WebAssembly.Memory).buffer, this.pointer+writeoffset, data.length)
        writebuffer.set(data)
    }

    destroy() {
        this.F.destroy_buffer(this.pointer)
        this.pointer = -1
    }
}

const importObject = {
    env: {
        emscripten_notify_memory_growth: function(...args: any) {
           // don't need to adjust views, since views are only created
           // on read/write
           // which do not occur during create_buffer/destroy_buffer
        },
    }
}

interface WASMCONTEXTINTERFACE {
    initialized: boolean,
    path: string,
    importObject: typeof importObject,
    F?: ExtractInterface,
    instance?: WebAssembly.Instance
    ice?: ICE,
}
const WASMCONTEXT : WASMCONTEXTINTERFACE = {
    initialized: false,
    path: wasmpath,
    importObject: importObject,
} 

export function initialize() : void {
    if (WASMCONTEXT.initialized) {
        return
    }
    const WASMcode = fs.readFileSync(WASMCONTEXT.path)
    const module = new WebAssembly.Module(WASMcode)
    const instance: WebAssembly.Instance = new WebAssembly.Instance(module, WASMCONTEXT.importObject)
    WASMCONTEXT.F = instance.exports as ExtractInterface
    WASMCONTEXT.instance = instance
    
    WASMCONTEXT.ice = WASMCONTEXT.F.create_ice(0)
    const icekey = new WasmBuffer(8, WASMCONTEXT.instance, WASMCONTEXT.F)
    icekey.write(Buffer.from(wasmkey, 'hex'))
    WASMCONTEXT.F.set_ice(WASMCONTEXT.ice, icekey.pointer)
    icekey.destroy()
}

export async function decode(data: Buffer) : Promise<Buffer> {
    if (data.length%8!==0) {
        throw new Error(`Expected buffer length divisible by 8, actual: ${data.length}`)
    }
    if (!WASMCONTEXT.instance || !WASMCONTEXT.F || !WASMCONTEXT.ice) {
        throw new Error('Failed to initialize WASM')
    }

    const decodeObject = new WasmBuffer(data.length, WASMCONTEXT.instance, WASMCONTEXT.F)
    decodeObject.write(data)
    WASMCONTEXT.F.decrypt(WASMCONTEXT.ice, decodeObject.pointer, decodeObject.pointer, data.length/8)
    const decodedData = decodeObject.read(data.length,0)
    decodeObject.destroy()

    return decodedData
}

export async function decompress(data: Buffer, size: number) : Promise<Buffer> {
    if (!WASMCONTEXT.instance || !WASMCONTEXT.F || !WASMCONTEXT.ice) {
        throw new Error('Failed to initialize WASM')
    }
    
    const dataObject = new WasmBuffer(data.length, WASMCONTEXT.instance, WASMCONTEXT.F)
    const decompressObject = new WasmBuffer(size, WASMCONTEXT.instance, WASMCONTEXT.F)
    dataObject.write(data)
    WASMCONTEXT.F.unpack(dataObject.pointer, decompressObject.pointer)
    const decompressedData = decompressObject.read(size,0)
    dataObject.destroy()
    decompressObject.destroy()

    return decompressedData
}

export function workerDecodeDecompress(data: ArrayBuffer, size: number) : ArrayBuffer {
    if (!WASMCONTEXT.instance || !WASMCONTEXT.F || !WASMCONTEXT.ice) {
        throw new Error('Failed to initialize WASM')
    }
    const dataObject = new WasmBuffer(data.byteLength, WASMCONTEXT.instance, WASMCONTEXT.F)
    dataObject.write(Buffer.from(data))
    
    WASMCONTEXT.F.decrypt(WASMCONTEXT.ice, dataObject.pointer, dataObject.pointer, data.byteLength/8)

    let outdata: ArrayBuffer
    if (validHeader(dataObject, size)) {
        const outObject = new WasmBuffer(size, WASMCONTEXT.instance, WASMCONTEXT.F)
        WASMCONTEXT.F.unpack(dataObject.pointer, outObject.pointer)
        outdata = outObject.read(size,0).buffer
        outObject.destroy()
    } else {
        outdata = dataObject.read(size,0).buffer
    }
    dataObject.destroy()
  

    return outdata
}

function validHeader(data: WasmBuffer, size: number) : boolean {
    if(data.length < 1) {
        return false
    }

    const flags = data.read(1,0).readUInt8()
    const headerIsByte = (flags & 2) === 0
    const numberSize = headerIsByte ? 1 : 4
    const headerSize = numberSize*2+1

    if(data.length < headerSize) {
        return false
    }

    // 6E or 6F
    if(flags!=110 && flags!=111){
        return false
    }

    // let dataSize // not actually used here, think it is a boundary check for the unpack alg.
    let decompressedSize
    if (headerIsByte) {
        // dataSize = buffer.readUInt8(1)
        decompressedSize = data.read(1,2).readUInt8()
    } else {
        // dataSize = buffer.readUInt32LE(1)
        decompressedSize = data.read(4,5).readUInt32LE()
    }

    if (size === decompressedSize) {
        return true
    } else {
        // not valid
        return false
    }
}