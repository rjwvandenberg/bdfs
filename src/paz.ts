import { BDOFile } from './bdofile'
import * as emg from './emguard'
import { Extractor } from './extractor'

export class Paz {
    files: BDOFile[]
    constructor(
        public path: string,
        public number: number,
        public uuid: number
    ) {
        this.files = new Array<BDOFile>()
    }

    addFile(file: BDOFile) : void {
        this.files.push(file)
    }

    async extractAll(extractor: Extractor, filefilter: (file: BDOFile)=>boolean) : Promise<void> {
        // load file
        // promise convert->extract
        // await all conver->extract
        //return

        let filesToExtractSize = 0
        const filesToExtract = this.files.filter(f => {
            if (filefilter(f)) {
                filesToExtractSize += f.size
                return true
            } else {
                return false
            }
        })
        extractor.addSize(filesToExtractSize)
       
        const readPromise: Promise<void> = new Promise<void>((resolve,reject) => {
            emg.readFile(this.path, null)
                .then(data=>{resolve(); return data})
                .then(data => {
                filesToExtract.forEach(f => {
                    if (filefilter(f)) {
                        f.extract(extractor, data)
                    }
                })
            })
            .catch(err=>reject(err))
        })
        extractor.addReadPromise(readPromise)
    }
}