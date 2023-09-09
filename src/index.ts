/**
 * BDFS is a gamefile unpacker for Black Desert Online
 *    It allows for extraction of all files, and partial extraction of updated and added files when compared to previous versions.
 */
import * as fsutil from './fsutil'
import * as com from './command'
import { initialize as initializeWASM } from './wasm'
import { closeWorkers } from './workers'

const INVALIDCOMMANDMSG = `
node index.js <command> 
              extract           <padpath> <pazfolderpath> <extractfolder>       full extract for pad and paz into extractfolder/
              createsha1map     <padpath> <pazfolderpath> <extractfile>         bootstrap sha1map for pad and paz provided
              update            <bdofolder> <previousupdatefolder> <updatefolder>      update by comparing bdofolder/ to previousupdate/ into updatefolder/ 
              createcurrent     <versionsfolder> <currentversion>               create current/ directory if no current/version present
              updatecurrent     <versionsfolder> <currentversion>               update current/ to currentversion if currentversion > current/version
              checkcurrent      <versionsfolder>                                 check filesizes in current/
`

process.on('beforeExit', exit_program)
process.on('uncaughtException', exit_program)
function exit_program() {
    console.timeEnd('runtime')
}

console.time('runtime')

initializeWASM()

try {
    const command = process.argv[2].toLowerCase()
    switch(command) {
        case 'extract': {
            const padpath = fsutil.checkDir(process.argv[3])
            const pazfolderpath = fsutil.checkDir(process.argv[4])
            const extractfolder = fsutil.checkDir(process.argv[5])
            com.extract(padpath, pazfolderpath, extractfolder)
            break
        }
        case 'createsha1map': {
            const padpath = fsutil.checkDir(process.argv[3])
            const pazfolderpath = fsutil.checkDir(process.argv[4])
            const extractfile = fsutil.checkFile(process.argv[5])
            com.createSha1Map(padpath, pazfolderpath, extractfile)
            break
        }
        case 'update': {
            const bdofolder = fsutil.checkDir(process.argv[3])
            const previousupdatefolder = fsutil.checkDir(process.argv[4])
            const updatefolder = fsutil.checkDir(process.argv[5])
            com.update(bdofolder, previousupdatefolder, updatefolder)
            break
        }
        case 'createcurrent': {
            const versionsfolder = fsutil.checkDir(process.argv[3])
            const currentversion = parseInt(process.argv[4])
            com.createcurrent(versionsfolder, currentversion)
            break
        }
        case 'updatecurrent': {
            const versionsfolder = fsutil.checkDir(process.argv[3])
            const currentversion = parseInt(process.argv[4])
            com.updatecurrent(versionsfolder, currentversion)
            break
        }
        case 'checkcurrent': {
            const versionsfolder = fsutil.checkDir(process.argv[3])
            com.checkcurrent(versionsfolder)
            break
        }
        default: {
            console.log(`Invalid command: ${command}`)
            console.log(INVALIDCOMMANDMSG)
            break
        }
    }
} catch (err) {
    console.log (`Encountered unexpected error, so throwing it again!`)
    console.log(INVALIDCOMMANDMSG)
    closeWorkers()
    throw err
}

