import { BDOFile } from "./bdofile"
import { createHash } from 'crypto'
import { readFile } from './emguard'
import { Pad } from './pad'
import * as fs from "fs"

export class Sha1Entry {
    sha1: Buffer
    constructor(public file: BDOFile, public version: number, data: Buffer) {
        this.sha1 = computeSha1(data)
    }
}

export async function loadMap(sha1path: string, globaluuidmap: Map<string,BDOFile>) : Promise<Map<string,Sha1Entry>> {
    return readFile(sha1path, null).then(data=>{
        const sha1map = new Map<string,Sha1Entry>()
        let pos = 0
        while(pos < data.length) {
            const paz = data.readUInt32LE(pos)
            const uuid = data.readUInt32LE(pos+4)
            const version = data.readUInt32LE(pos+8)
            const sha1 = data.slice(pos+12,pos+32)
            const globaluuid = makeglobaluuid(paz, uuid)
            const file = {sha1: sha1, version: version, file: globaluuidmap.get(globaluuid)} as Sha1Entry
            sha1map.set(globaluuid, file)
            pos += 32
        }
        return sha1map
    })
}

export function saveMap(sha1path: string, sha1map: Map<string, Sha1Entry>) : void{
    const outb = Buffer.alloc(32 * sha1map.size)
    let i = 0
    sha1map.forEach((se,g)=>{
        const offset = i*32
        outb.writeUInt32LE(se.file.paz,offset)
        outb.writeUInt32LE(se.file.uuid, offset+4)
        outb.writeUInt32LE(se.version, offset+8)
        se.sha1.copy(outb, offset+12, 0, 20)
        i++
    })
    fs.writeFileSync(sha1path, outb)
}

function makeglobaluuid(paz: number, uuid: number) {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(paz)
    b.writeUInt32LE(uuid, 4)
    return b.toString('hex')
}

export function computeSha1(data: Buffer) : Buffer {
    const hasher = createHash('sha1')
    hasher.update(data)
    return hasher.digest()
}