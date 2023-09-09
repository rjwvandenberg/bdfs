import * as fs from 'fs'
import * as os from 'os'
const errno = os.constants.errno

let interval = 0

// Abstractions to handle errors when opening and closing many files.

// guard against EMFILE error by retrying later
// guard against EEXIST error by reporting success

// so when error too many filehandles do not reject, but readd to queue
// any other error, do reject
// on success resolve the guard

function attempt<T>(fsFunction: Function, ...args: any[]) : Promise<T>  {
    return new Promise<T>((resolve, reject) => {
        emguard<T>(resolve, reject, fsFunction, ...args)
    })
}

function retry<T>(fsFunction: Function, emguard: Function, ...args: any[]) {
    setTimeout(()=>fsFunction(...args, emguard), interval)
}

function emguard<T>(resolve: Function, reject: Function, fsFunction: Function, ...args: any[]) {
    const retryobj: {F: Function} = {F: ()=>{}}
    const guard = function(err: NodeJS.ErrnoException, res: T) {
        if (err && err.code !== 'EEXIST') {
            if (err.code === 'EMFILE') {
                interval = Math.min((interval+10)*1.1, 5000.0)
                retryobj.F()
            } else {
                // normal behaviour
                reject(err)
            }
        } else {
            interval *= 0.5
            resolve(res)
        }
    }
    retryobj.F = function(){retry<T>(fsFunction, guard, ...args)}
    retryobj.F()
}

export function readFile(path: string, options: {flag?: string} | null) : Promise<Buffer>{
    return attempt<Buffer>(fs.readFile, path, options)
}

export function writeFile(path: string, data: Buffer, options: fs.WriteFileOptions) : Promise<undefined> {
    return attempt<undefined>(fs.writeFile, path, data, options)
}

export function mkdir(path: string, options: {recursive:boolean}) : Promise<string> {
    return attempt<string>(fs.mkdir, path, options)
}

export function copyFile(src: string, dst: string, options: number) : Promise<undefined> {
    return attempt<undefined>(fs.copyFile, src, dst, options)
}

export function link(existingpath: string, newpath: string) : Promise<undefined> {
    return attempt<undefined>(fs.link, existingpath, newpath)
}

export function unlink(path: string) : Promise<void> {
    return attempt<void>(fs.unlink, path)
}