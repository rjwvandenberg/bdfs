import { Pad } from "./pad";
import { closeWorkers } from "./workers"
import { readFile, writeFile, copyFile, mkdir, link, unlink } from './emguard'
import * as fs from 'fs'
import * as path from 'path'
import * as Sha1 from './sha1'
import { BDOFile } from './bdofile'

export function extract(padpath: string, pazfolderpath: string, extractfolder: string) : void {
    // could add extension check after converting in bdofile.convert

    // Wasm in worker, causes double copy of data, readfile -> copybuffer -> wasm -> returnbuffer -> mainthread
    // any workaround? 
    // We already prevent an additional copy of copybuffer and returnbuffer by adding them to transferlist in postmessage
    // Maybe try use SharedBuffer as Webassembly.Memory? 
    // different threads allocating/deallocating in the same SharedBuffer
    // But different threads, do not work in eachothers allocated memory chuncks
    // so only need to synchronize create_buffer, destroy_buffer
    // so memory reservation in the Webassembly.Memory is not overlapped

    // we could create buffers in main_thread and pass the pointers to workers
    // this would result in a readfile -> wasmsharedbuffer 
    // or just put entire readfile immediately into sharedbuffer

    // or read into sharedbuffer

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/Memory

    // will need to pass the sharedarray to workers
    // and pass the sharedbuffer to init

    // https://blog.scottlogic.com/2019/07/15/multithreaded-webassembly.html

    // works well enough atm, so not really needed, but could be cool to explore later

    // if want to convert to continuous process, instead of 1gb batches
    // need to setup a pipe or something and control memory usage by halting work
    // if pipe is full

    Pad.loadPad(padpath, pazfolderpath)
        .then(pad=>pad.extractAll(extractfolder))
}

export function createSha1Map(padpath: string, pazfolderpath: string, extractfile: string) {
    const { Sha1Entry } = require('./sha1')

    Pad.loadPad(padpath, pazfolderpath)
        .then(async pad=>{
            const promises: Promise<typeof Sha1Entry[]>[] = []
            for(let i = 1; i <= pad.pazcount; i++){
                const pf = pad.pazfiles[i]
                if(!pf) {return}
                promises.push(new Promise<typeof Sha1Entry[]>(async (resolve, reject)=>{
                    resolve(
                        await readFile(pf.path, null)
                            .then((data: Buffer)=>
                                pf.files.map(f=>new Sha1Entry(f, pad.version, data.slice(f.offset,f.offset+f.csize)))
                            )
                    )
                }))
                if (pf.number%100==0) {
                    console.log(pf.number)
                    await Promise.all(promises)
                }
            }

            const entries = await Promise.all(promises)
            const sha1entries = [] as typeof Sha1Entry[]
            entries.forEach(e=>e.forEach(se=>sha1entries.push(se)))
            return sha1entries
        })
        .then(entries=>{
            if(!entries){
                throw new Error('no entries')
            }
            const outb = Buffer.alloc(32 * entries.length)
            entries.forEach((se,i)=>{
                const offset = i*32
                outb.writeUInt32LE(se.file.paz,offset)
                outb.writeUInt32LE(se.file.uuid, offset+4)
                outb.writeUInt32LE(se.version, offset+8)
                se.sha1.copy(outb, offset+12,0,20)
            })
            return outb
        })
        .then(outdata=>{
            writeFile(extractfile, outdata, null)
        })
        .then(p=>
            closeWorkers()
        )
        .catch(err=>{
            console.log(err)
            process.exit()
        })
}

export async function update(bdofolder: string, previousupdatefolder: string, updatefolder: string) {
    // version.dat removed after service transfer from kakao to pearl abyss
    //const currentversion = parseInt(fs.readFileSync(path.join(bdofolder, 'version.dat'),{encoding:'latin1'}))
    const currentversion = parseInt(path.basename(updatefolder))
    const previousversion = parseInt(path.basename(previousupdatefolder))
    if (previousversion >= currentversion) {
        throw new Error(`Cannot update ${previousversion} to ${currentversion}`)
    }

    console.log(`Updating ${previousversion} -> ${currentversion}`)
    let changelog = `previousversion: ${previousversion}\n`
    changelog += `currentversion: ${currentversion}\n`

    readFile(path.join(updatefolder, `${currentversion}.update.log`),null)
        .then(data=>checkClientVersions(data, previousversion, currentversion))
        .then(async ()=>{
            // updatelog no longer mentions changed paz files, so 
            // await copyFiles(filesarray, bdofolder, updatefolder)
            await copyFile(path.join(bdofolder,'paz/pad00000.meta'), path.join(updatefolder, `${currentversion}.meta`), fs.constants.COPYFILE_EXCL)
        })
        .then(async ()=>{
            const [previouspad, currentpad] = await Promise.all([
                Pad.loadPad(path.join(previousupdatefolder, `${previousversion}.meta`), path.join(previousupdatefolder,'bdo','paz')),
                Pad.loadPad(path.join(updatefolder,`${currentversion}.meta`), path.join(updatefolder, 'bdo', 'paz'))
            ])
            if (previouspad.version!==previousversion || currentpad.version!==currentversion){
                throw new Error('pad version mismatch')
            }
            const previousuuidmap = new Map<string,BDOFile>()
            previouspad.pazfiles.forEach(pf=>{
                pf.files.forEach(f=>{
                    previousuuidmap.set(f.globaluuid, f)
                })
            })
            const globaluuidmap = new Map<string,BDOFile>()
            currentpad.pazfiles.forEach(pf=>{
                pf.files.forEach(f=>{
                    globaluuidmap.set(f.globaluuid, f)
                })
            })
            const sha1map = await Sha1.loadMap(path.join(previousupdatefolder, `${previousversion}.sha1`), globaluuidmap)
            
            // check for removed files
            let removed = ''
            let r = 0
            let updatedpazset = new Set<number>();
            previousuuidmap.forEach((f,g)=>{
                const sf = sha1map.get(g)
                if (sf && !sf.file) {
                    removed += `${JSON.stringify({
                        paz: f.paz, uuid: f.uuid, version: sf.version, folder: f.folder, file: f.file, sha1: sf.sha1
                    })},\n`
                    sha1map.delete(g)
                    r++
                    updatedpazset.add(f.paz)
                }
            })

            console.log('Comparing paths')
            globaluuidmap.forEach((f,g)=>{
                const pf = previousuuidmap.get(g)
                if (pf) {
                    const fpath = path.join(f.folder, f.file).toLowerCase()
                    const pfpath = path.join(pf.folder, pf.file).toLowerCase()
                    if (fpath !== pfpath) {
                        throw new Error(`${JSON.stringify(f)} path does not match ${JSON.stringify(pf)}`)
                    }
                } 
            })

            let added = ''
            let changed = ''
            let a = 0
            let c = 0
            
            // Check added and changed files
            console.log('Processing paz')
            for(let currentpazindex = 1; currentpazindex <= currentpad.pazcount; currentpazindex++) {
                const pf = currentpad.pazfiles[currentpazindex]
                console.log(`Processing ${pf.number} ${pf.path}`)
                //const data = fs.readFileSync(pf.path)
                const data = fs.readFileSync(path.join(bdofolder, 'paz', path.basename(pf.path)))

                const extract: {data: Buffer, file: BDOFile}[] = []
                let updatedfilecount = 0
                pf.files.forEach(f=>{
                    const fdata = data.slice(f.offset, f.offset+f.csize)
                    const fsha1 = Sha1.computeSha1(fdata)
                    let se = sha1map.get(f.globaluuid)
                    if (!se) {
                        //added
                        sha1map.set(f.globaluuid, {file: f, version: currentversion, sha1: fsha1} as Sha1.Sha1Entry)
                        added += `${JSON.stringify({
                            paz: f.paz, uuid: f.uuid, version: currentversion, folder: f.folder, file: f.file, sha1: fsha1
                        })},\n`
                        extract.push({data: data, file: f})
                        a++
                        updatedfilecount++
                    } else if (se.sha1.compare(fsha1)!==0) {
                        // updated
                        sha1map.set(f.globaluuid, {file: f, version: currentversion, sha1: fsha1} as Sha1.Sha1Entry)
                        changed += `${JSON.stringify({
                            paz: f.paz, uuid: f.uuid, version: currentversion, previousversion: se.version, folder: f.folder, file: f.file, sha1: fsha1, previoussha1: se.sha1
                        })},\n`
                        extract.push({data: data, file: f})
                        c++
                        updatedfilecount++
                    }
                })
                if (updatedfilecount > 0) {
                    updatedpazset.add(currentpazindex)
                }

                console.log(`Extracting paz ${currentpazindex} - ${extract.length} files`)

                let promises: Promise<undefined | string>[] = []
                const folders = new Set<string>(extract.map(e=>e.file.folder))
                folders.forEach(f=>{if(f){promises.push(mkdir(path.join(updatefolder,'files',f),{recursive:true}))}})
                await Promise.all(promises)
                promises = []

                for (let i = 0; i < extract.length; i++) {
                    let e = extract[i]
                    promises.push( extractFile(updatefolder, e.file, e.data) )
                }
                
                await Promise.all(promises)
            }

            // copy updatedpazfiles
            let pazfilepaths = Array.from(updatedpazset).map(
                pn => {
                    let paznumber = `00000${pn}`.slice(-5)
                    return `Paz\\PAD${paznumber}.PAZ`
                }
            )
            pazfilepaths.push(`Paz\\pad00000.meta`)
            await copyFiles(pazfilepaths, bdofolder, updatefolder)

            changelog += `updatedpaz: ${Array.from(updatedpazset)}\n`
            changelog += `removed: \n[\n${removed}]\n`
            changelog += `added: \n[\n${added}]\n`
            changelog += `changed: \n[\n${changed}]\n`
            changelog += `updateNumbers: \n${JSON.stringify({added: a, removed: r, changed: c})}`

            if (globaluuidmap.size !== sha1map.size) {
                throw new Error(`${globaluuidmap.size} globaluuidmap.size !== sha1map.size ${sha1map.size}`)
            }

            fs.writeFileSync(path.join(updatefolder, `${currentversion}.log`), changelog)
            Sha1.saveMap(path.join(updatefolder, `${currentversion}.sha1`), sha1map)

            return extract
        })
        .then(async extract=>{
            // console.log(`Extracting ${extract.length} files`)

            // const promises: Promise<undefined | string>[] = []
            // const folders = new Set<string>(extract.map(e=>e.file.folder))
            // folders.forEach(f=>{if(f){promises.push(mkdir(path.join(updatefolder,'files',f),{recursive:true}))}})
            // await Promise.all(promises)

            // for (let i = 0; i < extract.length; i++) {
            
            //         let e = extract[i]
            //         await extractFile(updatefolder, e.file, e.data)
            //         // convertInWorker(e.file.globaluuid, e.data, e.file.size)
            //         //     .then(data => writeFile(path.join(updatefolder, 'files', e.file.folder, e.file.file), data, {flag: 'wx'}))
            //         //     .then(v=>resolve())
            //         //     .catch(e=>reject(e))
            //         //})
            // }
            
            // return Promise.resolve()
        })
        .catch(err=>{
            console.log(err)
        })
        .then(()=>{
            console.log(`Don't forget to copy ads/client/etc.`)
            closeWorkers()
        })
}

async function extractFile(updatefolder: string, file: BDOFile, data: Buffer) : Promise<undefined> {
    return file.convert(data.slice(file.offset, file.offset+file.csize))
            .then(outdata =>
                writeFile(path.join(updatefolder, 'files', file.folder, file.file), outdata, {flag:'wx'})
            )
}

// transition from 1414 to 1539 for updatedpazfiles
async function checkClientVersions(data: Buffer, previousversion: number, currentversion: number) {
    const datastr = data.toString('utf8').split(/\r|\n/)
    
    // check update versions in update.log match the ones giving on cmdline
    const latestversioncheck = '[INFO	] latest version: '
    const clientversioncheck = '[INFO	] client version: '
    let chlatest = -1
    let chclient = -1
    let line = '' + datastr.find((line)=>line.includes(latestversioncheck))
    chlatest = parseInt(path.basename(line.split(latestversioncheck).reverse()[0]))
    line = '' + datastr.find((line)=>line.includes(clientversioncheck))
    chclient = parseInt(path.basename(line.split(clientversioncheck).reverse()[0]))

    if (chlatest != currentversion) {
        throw new Error(`.update.log latest version ${chlatest} does not match currentversion ${currentversion}`)
    }
    if (chclient != previousversion) {
        throw new Error(`.update.log client version ${chclient} does not match previousversion ${previousversion}`)
    }

    const patchversion = new Set()
    const patchcheck = '[INFO	] csvi updated: '
    datastr.forEach((line)=>{
        if (line.includes(patchcheck)){
            const v = parseInt(line.split(' ').reverse()[0])
            patchversion.add(v)
        }
    })

    for (let includedversion = previousversion+1; includedversion <= currentversion; includedversion++){
        if (!patchversion.has(includedversion)) {
            throw new Error(`.update.log does not include version ${includedversion}`)
        }
    }
    console.log(`Patch versions to process : ${JSON.stringify(Array.from(patchversion))}`)
}

// Old patchcheck from before service transfer 
//
// async function getUpdatedPazAndFiles(data: Buffer, previousversion: number, currentversion: number) : Promise<string[]> {
//     const datastr = data.toString('utf8').split(/\r|\n/)
//     // first make sure all versions between compare version and outputversion are included
//     const patchversion = new Set()
//     const patchcheck = '[MSG] patch file ='
//     datastr.forEach((line)=>{
//         if (line.includes(patchcheck)){
//             const v = parseInt(path.basename(line.split(patchcheck).reverse()[0]).split('.')[0])
//             patchversion.add(v)
//         }
        
//     })
//     for (let includedversion = previousversion+1; includedversion <= currentversion; includedversion++){
//         if (!patchversion.has(includedversion)) {
//             throw new Error(`.update.log does not include version ${includedversion}`)
//         }
//     }
//     console.log(`Patch versions to process : ${JSON.stringify(Array.from(patchversion))}`)

//     const copylist = new Set<string>()
//     const check = '[MSG] RTPatch file name : '
//     datastr.forEach((line)=>{
//         if (line.includes(check)) {
//             const file = line.split(check).reverse()[0]
//             copylist.add(file.trim())
//         }
//     })
//     return Array.from(copylist)
// }

async function copyFiles(filesarray: string[], bdofolder: string, updatefolder: string) {
    console.log(`Copying files to ${path.join(updatefolder, 'bdo')}`)
    let promises: Promise<undefined | string>[] = []
    const folders = new Set<string>(filesarray.map(f=>path.dirname(f)))
    folders.forEach(f=>{if(f){promises.push(mkdir(path.join(updatefolder,'bdo',f),{recursive:true}))}})
    await Promise.all(promises)
    promises = []
    filesarray.forEach(f=>promises.push(copyFile(path.join(bdofolder,f),path.join(updatefolder,'bdo',f),fs.constants.COPYFILE_EXCL)))
    return Promise.all(promises)
}

export async function createcurrent(versionsfolder: string, currentversion: number) : Promise<void> {
    const currentfolder = path.join(versionsfolder, 'current', 'files')
    
    fs.promises.writeFile(path.join(path.dirname(currentfolder), 'version'), `${currentversion}`, {flag: 'wx'})
        .then(()=>
            Pad.loadPad(path.join(versionsfolder, `${currentversion}`, `${currentversion}.meta`), '')
        )
        .then(pad=>{
            console.log('Loading sha1map')
            const globaluuidmap = new Map<string, BDOFile>()
            pad.pazfiles.forEach(pf=>{
                pf.files.forEach(f=>{
                    globaluuidmap.set(f.globaluuid, f)
                })
            })
            return Sha1.loadMap(path.join(versionsfolder, `${currentversion}`, `${currentversion}.sha1`), globaluuidmap)
        })
        .then(async sha1map => {
            console.log('Creating folders')
            let promises: Promise<undefined | string>[] = []
            const folders = new Set<string>()
            sha1map.forEach(se=>folders.add(se.file.folder))
            folders.forEach(f=>{if(f){promises.push(mkdir(path.join(currentfolder,f),{recursive:true}))}})
            await Promise.all(promises)

            promises = []
            console.log(`Creating ${sha1map.size} hardlinks`)
            const keys = Array.from(sha1map.keys())
            for(let i = 0; i < keys.length; i++) {
                const se = sha1map.get(keys[i])
                if (!se) {
                    throw new Error('peculiar, key that exists was not found')
                }
                promises.push(
                    link(
                        path.join(versionsfolder, `${se.version}`, 'files', se.file.folder, se.file.file),
                        path.join(currentfolder, se.file.folder, se.file.file)
                    )
                )
                if ((i % 1000) ===0) {
                    process.stdout.write(`${i} `)
                }
                if ((i%100)==0) {
                    await Promise.all(promises).catch(err=>{console.log(err); process.exit()})
                    promises = []
                }
            }
            if (promises.length > 0) {
                await Promise.all(promises)
            }
            console.log('\nDone writing hardlinks')
        })
        .catch(err=>console.log(err))
        .then(()=>closeWorkers())    
}


export async function updatecurrent(versionsfolder: string, currentversion: number) : Promise<void> {
    // version.log remove, update, add
    const currentfolder = path.join(versionsfolder, 'current', 'files')
    const previousversion = parseInt(fs.readFileSync(path.join(path.dirname(currentfolder), 'version'), 'utf8'))
    if (previousversion >= currentversion){
        throw new Error(`Cannot update from ${previousversion} to ${currentversion}`)
    }
    console.log(`Updating current/ from ${previousversion} to ${currentversion}`)
    fs.promises.readFile(path.join(versionsfolder, `${currentversion}`, `${currentversion}.log`), 'utf8')
        .then(data => {
            console.log('Parsing remove,add,update structures')
            const removesplit = data.split('\nremoved: \n')
            const addsplit = removesplit[1].split('\nadded: \n')
            const changesplit = addsplit[1].split('\nchanged: \n')
            const updatesplit = changesplit[1].split('\nupdateNumbers: \n')
            
            // check that <currentversion>.log, previousversion matches
            // current/version
            // otherwise the update cannot be applied
            const updatelogpreviousversion = parseInt(removesplit[0].split('\ncurrentversion: ')[0].split('previousversion: ')[1])
            if (updatelogpreviousversion!==previousversion){
                throw new Error(`Cannot apply ${currentversion}.log update to current ${previousversion}. Expected ${updatelogpreviousversion} by log update`)
            }

            // check splits are size 2
            if (removesplit.length!==2 || addsplit.length !==2 || changesplit.length!==2 || updatesplit.length!==2) {
                throw new Error('Split length not 2 ')
            }

            const removed = parseJSON(addsplit[0])
            const added = parseJSON(changesplit[0])
            const changed = parseJSON(updatesplit[0])
            console.log(updatesplit[1])
            const updateNumbers = JSON.parse(updatesplit[1])

            if(updateNumbers.removed!==removed.length || updateNumbers.added!==added.length || updateNumbers.changed!==changed.length) {
                throw new Error('update.log not correctly parsed')
            }
            console.log('update.log correctly parsed')

            return {removed: removed, added: added, changed: changed}
        })
        .then(async updatedata=>{
            console.log(`removing hardlinks ${updatedata.removed.length}`)
            let promises: Promise<void|string>[] = []
            for(let i = 0; i < updatedata.removed.length; i++){
                const f = updatedata.removed[i]
                promises.push(
                    unlink(path.join(currentfolder, f.folder, f.file))
                )
                if (promises.length%100===0) {
                    await Promise.all(promises)
                    promises = []
                }
            }
            await Promise.all(promises)

            let folders = new Set<string>(updatedata.removed.map(f=>f.folder))
            console.log(`removing ${folders.size} folders for removed hardlinks`)
            let folderlist = Array.from(folders)
            for(let i = 0; i < folderlist.length; i++) {
                let f = folderlist[i]
                let gotoparent = true
                while(f && gotoparent) {
                    await fs.promises.rmdir(path.join(currentfolder, f))
                                .then(()=>console.log(`Removed ${path.join(currentfolder, f)}`))
                                .catch(err=>gotoparent=false)
                    f = path.dirname(f)
                }             
            }
            
            promises = []
            folders = new Set<string>(updatedata.added.map(f=>f.folder))
            console.log(`creating ${folders.size} folders for added hardlinks`)
            folders.forEach(f=>{if(f){promises.push(mkdir(path.join(currentfolder,f),{recursive:true}))}})
            await Promise.all(promises)

            console.log(`adding hardlinks ${updatedata.added.length}`)
            promises = []
            for(let i = 0; i < updatedata.added.length; i++){
                const f = updatedata.added[i]
                promises.push(
                    link(
                        path.join(versionsfolder, `${f.version}`, 'files', f.folder, f.file),
                        path.join(currentfolder, f.folder, f.file)
                    )
                )
                if (promises.length%100===0) {
                    await Promise.all(promises)
                    promises = []
                }
            }
            await Promise.all(promises)

            console.log(`changing hardlinks ${updatedata.changed.length}`)
            promises = []
            for(let i = 0; i < updatedata.changed.length; i++){
                const f = updatedata.changed[i]
                promises.push(
                    unlink(path.join(currentfolder, f.folder, f.file))
                        .then(()=>{
                            return link(
                                path.join(versionsfolder, `${f.version}`, 'files', f.folder, f.file),
                                path.join(currentfolder, f.folder, f.file)
                            )
                        })
                        .catch(err=>{console.log(err);process.exit();})
                )
                if (promises.length%100===0) {
                    await Promise.all(promises)
                    promises = []
                }
            }
            await Promise.all(promises)
        })
        .then(()=>{
            fs.promises.writeFile(path.join(path.dirname(currentfolder),'version'), `${currentversion}`)
            console.log('done')
        })
        .catch(err=>console.log(err))
        .then(()=>closeWorkers())
}

function parseJSON(data: string) : any[] {
    return data.split('\n')
        .filter(l=>l.startsWith('{'))
        .map(l=>JSON.parse(l.slice(0,l.length-1)))
}

export async function checkcurrent(versionsfolder: string) {
    const currentfolder = path.join(versionsfolder, 'current', 'files')
    const currentversion = parseInt(fs.readFileSync(path.join(path.dirname(currentfolder), 'version'), 'utf8'))
    Pad.loadPad(path.join(versionsfolder, `${currentversion}`, `${currentversion}.meta`), '')
        .then(async pad=>{
            
            for(let p = 1; p <= pad.pazcount; p++){
                const paz = pad.pazfiles[p]
                let promises: Promise<void>[] = []
                for (let f = 0; f < paz.files.length; f++) {
                    const file = paz.files[f]
                    promises.push( 
                        fs.promises.stat(path.join(currentfolder, file.folder, file.file))
                            .then(stats=> {
                                if (file.size !== stats.size) {
                                    throw new Error(`File size mismatch for ${path.join(file.folder,file.file)}\n  Actual filesize ${stats.size}\n  Expected filesize ${file.size}\n  Paz ${file.paz}`)
                                }
                            })
                    )
                    if (promises.length%100===0) {
                        await Promise.all(promises).catch(err=>{console.log(err);process.exit();})
                        promises = []
                    }
                }

                await Promise.all(promises).catch(err=>{console.log(err);process.exit();})

                console.log(`Checking done for paz ${paz.number}`)
            }

        })
        .catch(err=>{console.log(err); process.exit()})
        .then(()=>closeWorkers())
}