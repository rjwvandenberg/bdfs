import * as path from 'path'

export function checkDir(dirpath: string) : string {
    if (!path.isAbsolute(dirpath)) {
        dirpath = path.join(process.cwd(), dirpath)
    }
    return dirpath
}

export function checkFile(filepath: string) : string {
    if (!path.isAbsolute(filepath)) {
        filepath = path.join(process.cwd(), filepath)
    }
    return filepath
}