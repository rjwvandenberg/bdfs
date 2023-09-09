import {isMainThread, parentPort, Worker} from 'worker_threads'

type WorkType = {data: ArrayBuffer, globaluuid: string, size: number}
type ResultType = {data: ArrayBuffer, globaluuid: string}

    // Multiple workers probably not needed for speedup after swapping ICE encryption from JS port (real bit banger) to WASM

const W = {
    initialized: false,
    nextWorker: 0,
    workers: [] as Worker[],
    WORKERLIMIT: 16,
    workMap: new Map<string, Function>()    
}


if(isMainThread) {
    if (!W.initialized) {
        initializeMain()
    }
} else {
    const wasm = require('./wasm')
    wasm.initialize()
    if (!parentPort) {
        throw new Error('failed to load parentPort')
    }
    const pp = parentPort
    
    const handleWorkerMessage = (workerData: WorkType) => {
        const resultBuffer = wasm.workerDecodeDecompress(workerData.data, workerData.size)
        pp.postMessage({data: resultBuffer, globaluuid: workerData.globaluuid}, [resultBuffer])
    }

    pp.on('message', handleWorkerMessage)
}

function initializeMain() {
    for (let i = 0; i < W.WORKERLIMIT; i++){
        const worker = new Worker(__filename)
        worker.on('message', handleResultMessage)
        worker.on('error', (err)=>{console.log(err); process.exit()})
        W.workers.push(worker)
    }

    W.initialized = true
}

function handleResultMessage(result: ResultType) {
    const resolve = W.workMap.get(result.globaluuid)
    if (!resolve) {
        throw new Error('resolve function not added to workMap')
    }
    W.workMap.delete(result.globaluuid)
    resolve(Buffer.from(result.data))
}

export async function convertInWorker(globaluuid: string, data: ArrayBuffer, size: number) : Promise<Buffer> {
    const p = new Promise<Buffer>((resolve, reject) => {
        W.workMap.set(globaluuid, resolve)
        W.workers[W.nextWorker].postMessage({globaluuid: globaluuid, size: size, data: data}, [data])
        W.nextWorker = (W.nextWorker + 1) % W.WORKERLIMIT
    })

    return p
}

export async function closeWorkers() {
    W.workers.forEach(w=>w.terminate())
}