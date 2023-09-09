
import * as path from 'path'
import { Extractor, convertInWorker } from './extractor'
import * as emg from './emguard'

export class BDOFile {
    constructor(
        public paz: number,
        public uuid: number,
        public folder: string, 
        public file: string,
        public offset: number,
        public csize: number,
        public size: number,
    ){
    }

    get globaluuid() : string {
        const b = Buffer.alloc(8)
        b.writeUInt32LE(this.paz)
        b.writeUInt32LE(this.uuid, 4)
        return b.toString('hex')
    }

    // maybe global uuid = pazuuid + fileuuid
    // but pazfile has unique number, which is known here
    // so easier to use paznumber + fileuuid
    async convert(data: Buffer) : Promise<Buffer> {
        const ext = path.extname(this.file)
        let outdata : Buffer

        if (this.size===0 || this.csize===0) {
            outdata = Buffer.alloc(0)
        } else if (this.csize%8!==0 || ext === '.dbss') {
            outdata = data.slice(0, this.size)
        } else {
            // //replace with convertToWorker
            // outdata = await decode(data)
            // if (this.validHeader(outdata)) {
            //     outdata = await decompress(outdata, this.size)
            // }
            // console.log(data.buffer.slice(0,20))
            return convertInWorker(this.globaluuid, new Uint8Array(data).buffer, this.size)
        }

        if(outdata.length<this.size) {
            throw new Error('Expected bigger outdata')
        }

        // extension check
        // perform magic number check on converted data, etc., etc.

        return outdata
    }

    async extract(extractor: Extractor, data: Buffer) : Promise<void> {
        extractor.addExtractPromise(this.convert(data.slice(this.offset, this.offset+this.csize))
                .then(outdata => { return {path: path.join(this.folder, this.file), data: outdata} })
                .then(async dd => {
                    await Promise.all(extractor.readPromises)
                    return emg.writeFile(path.join(extractor.extractfolder, dd.path), dd.data, {flag:'wx'})
                })
                .catch(err => {
                    console.log('Encountered Error during conversion to extraction')
                    console.log(err)
                    process.exit()
                })
        )
    }
}