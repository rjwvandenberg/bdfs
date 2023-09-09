import { closeWorkers, convertInWorker as ciw } from './workers'

interface DataDefinition {
    path: string,
    data: Buffer,
}

export function convertInWorker(globaluuid: string, data: ArrayBuffer, size: number) : Promise<Buffer> {
    return ciw(globaluuid, data, size)
}

export class Extractor {
    filePromises: Promise<DataDefinition | void>[]
    readPromises: Promise<void>[]
    filessizesum: number
    constructor(public extractfolder: string, public sizelimit: number=1000000000) {
        this.filePromises = []
        this.readPromises = []
        this.filessizesum = 0
    }

    async addExtractPromise(dataPromise: Promise<{path: string, data: Buffer} | void>) : Promise<void> {
        this.filePromises.push(dataPromise)
    }

    async addReadPromise(readPromise: Promise<void>) {
        this.readPromises.push(readPromise)
    }

    async addSize(size: number) {
        this.filessizesum += size
    }

    async check() {
        if (this.filessizesum > this.sizelimit) {
            await this.extract()
        }
    }

    async extract() : Promise<void> {
        console.log()
        // need to wait for readpromises, otherwise not all extractpromises are added yet
        console.timeLog('1GB', 'Waiting for read promises')
        const l = await Promise.all(this.readPromises).then().catch(err=>{
            console.log('Rejected one of many read promises')
            console.log(`${err}`)
            process.exit()
        })
        this.readPromises = []

        console.timeLog('1GB', 'Waiting for extract promises')
        await Promise.all(this.filePromises)
        this.filePromises = []
        this.filessizesum = 0
        
        console.timeEnd('1GB')
        console.timeLog('runtime')
        console.time('1GB')
    }

    async close() : Promise<void> {
        if (this.filePromises.length > 0) {
            await this.extract()
        }
        closeWorkers()
    }

}