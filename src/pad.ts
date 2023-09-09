import { Paz } from './paz'
import * as emg from './emguard'
import * as path from 'path'
import { BDOFile } from './bdofile'
import { readPadStrings } from './bdoutil'
import { decode } from './wasm'
import { Extractor } from './extractor'

export class Pad {
    constructor(
        public version: number,
        public pazcount: number,
        public pazfiles: Paz[],
    ){}

    async makeFolders(extractfolder: string, pazfilter: (paz: Paz)=>boolean, filefilter: (file: BDOFile)=>boolean) : Promise<string[]> {
        const folders = new Set<string>()
        this.pazfiles.filter(pazfilter).forEach(paz => {
            paz.files.filter(filefilter).forEach(f => folders.add(f.folder))
        })
        
        const promises: Promise<string>[] = []
        folders.forEach(folder => promises.push(
            emg.mkdir(path.join(extractfolder, folder), {recursive: true})
        ))
        return Promise.all(promises)
    }

    async extractPaz(extractfolder: string, pazfilter: (paz: Paz)=>boolean, filefilter: (file: BDOFile)=>boolean) : Promise<void> {
        await this.makeFolders(extractfolder, pazfilter, filefilter)

        console.time('1GB')
        const extractor = new Extractor(extractfolder)
        for (let i = 1; i <= this.pazcount; i++) {
            const paz = this.pazfiles[i]
            if (pazfilter(paz)) {
                process.stdout.write(`${paz.number} `)
                paz.extractAll(extractor, filefilter)
            }
            await extractor.check()
        }
        await extractor.close()
        console.timeEnd('1GB')
        console.log('done extracting')
    }

    extractAll(extractfolder: string) : void {
        this.extractPaz(extractfolder, (paz: Paz)=>true, (file: BDOFile)=>true)
    }

    static async createPad(data: Buffer, pazfolderpath: string) : Promise<Pad> {
        const version = data.readUInt32LE()
        const pazcount = data.readUInt32LE(4)
        const pazfiles = []
        const pazfilesoffset = 8
        for(let i = 0; i < pazcount; i++){
            const pazfileoffset = pazfilesoffset + 12 * i
            const number = data.readUInt32LE(pazfileoffset)
            const uuid = data.readUInt32LE(pazfileoffset+4)
            const pazpath = path.join(pazfolderpath, `PAD${number.toString(10).padStart(5,'0')}.paz`)
            pazfiles[number] = new Paz(pazpath, number, uuid)
        }

        const filesoffset = pazfilesoffset + pazcount*(3*4) + 4
        const filescount = data.readUInt32LE(filesoffset-4)

        const foldernamesoffset = filesoffset + filescount*(7*4) + 4
        const foldernameslength = data.readUInt32LE(foldernamesoffset-4)
        
        const filenamesoffset = foldernamesoffset + foldernameslength + 4
        const filenameslength = data.readUInt32LE(filenamesoffset-4)
        
        const [foldernames, filenames] = await Promise.all([
            decode(data.slice(foldernamesoffset,foldernamesoffset+foldernameslength)).then(data=>readPadStrings(data, true)), 
            decode(data.slice(filenamesoffset,filenamesoffset+filenameslength)).then(data=>readPadStrings(data, false))
        ])

        for(let i = 0; i < filescount; i++){
            const fileoffset = filesoffset + i * 28
            const uuid = data.readUInt32LE(fileoffset)
            const folder = data.readUInt32LE(fileoffset+4)
            const file = data.readUInt32LE(fileoffset+8)
            const paz = data.readUInt32LE(fileoffset+12)
            const offset = data.readUInt32LE(fileoffset+16)
            const csize = data.readUInt32LE(fileoffset+20)
            const size = data.readUInt32LE(fileoffset+24)
            pazfiles[paz].addFile(new BDOFile(
                paz, uuid, foldernames[folder], filenames[file], offset, csize, size
            ))
        }

        return new Pad(version, pazcount, pazfiles)
    }

    static async loadPad(padpath: string, pazfolderpath: string) : Promise<Pad> {
        console.log('Loading pad')
        return emg.readFile(padpath, null).then(data => Pad.createPad(data, pazfolderpath))
    }
}